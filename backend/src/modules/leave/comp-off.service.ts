import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, Prisma, UserRole, WorkflowEntityType } from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { findUserIdForEmployee } from '../workflow/workflow.utils';
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from '../../common/utils/prisma-errors';

/** Either the root client or a transaction-scoped one, so helpers work in both. */
type PrismaClientLike = Prisma.TransactionClient;
import {
  CreateCompOffDto,
  ApproveCompOffDto,
  CompOffQueryDto,
} from './dto/comp-off.dto';

/** Relations the approve/reject endpoints have always returned. */
const COMP_OFF_RELATIONS = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      department: { select: { name: true } },
    },
  },
  approver: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.CompOffRequestInclude;

type CompOffWithRelations = Prisma.CompOffRequestGetPayload<{
  include: typeof COMP_OFF_RELATIONS;
}>;

@Injectable()
export class CompOffService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private workflow: ApprovalEngineService,
  ) {}

  /**
   * Create a comp-off request
   */
  async create(
    tenantId: string,
    employeeId: string,
    dto: CreateCompOffDto,
    requesterUserId?: string | null,
  ) {
    const workedDate = new Date(dto.workedDate);

    // Validate that the worked date is not in the future
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (workedDate > today) {
      throw new BadRequestException('Worked date cannot be in the future');
    }

    // Validate: must be a weekend or holiday date
    const dayOfWeek = workedDate.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Check if the date is a holiday
    const holiday = await this.prisma.holiday.findFirst({
      where: {
        tenantId,
        date: workedDate,
        isActive: true,
      },
    });

    if (!isWeekend && !holiday) {
      throw new BadRequestException(
        'Comp-off can only be requested for weekends or holidays',
      );
    }

    // Check for duplicate request
    const existing = await this.prisma.compOffRequest.findUnique({
      where: {
        tenantId_employeeId_workedDate: {
          tenantId,
          employeeId,
          workedDate,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'A comp-off request already exists for this date',
      );
    }

    // Set expiry date (90 days from worked date)
    const expiryDate = new Date(workedDate);
    expiryDate.setDate(expiryDate.getDate() + 90);

    const earnedDays = dto.earnedDays || 1.0;
    const userId =
      requesterUserId !== undefined
        ? requesterUserId
        : await findUserIdForEmployee(this.prisma, tenantId, employeeId);

    // The request and its approval instance are created together, so a
    // request can never sit PENDING with no chain to route it.
    const request = await this.prisma.$transaction(async (tx) => {
      const created = await tx.compOffRequest.create({
        data: {
          tenantId,
          employeeId,
          workedDate,
          reason: dto.reason,
          earnedDays,
          expiryDate,
          status: 'PENDING',
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: { select: { name: true } },
            },
          },
        },
      });

      await this.workflow.start({
        tenantId,
        entityType: WorkflowEntityType.COMP_OFF,
        entityId: created.id,
        context: {
          requesterEmployeeId: employeeId,
          requesterUserId: userId,
          days: Number(earnedDays),
        },
        tx,
      });

      return created;
    });

    void this.workflow.notifyPending(tenantId, WorkflowEntityType.COMP_OFF, request.id);

    return request;
  }

  /**
   * Get my comp-off requests (paginated)
   */
  async getMyRequests(
    tenantId: string,
    employeeId: string,
    query: CompOffQueryDto,
  ) {
    const { status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      tenantId,
      employeeId,
    };

    if (status) {
      where.status = status;
    }

    const [requests, total] = await Promise.all([
      this.prisma.compOffRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.compOffRequest.count({ where }),
    ]);

    return {
      data: requests,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Comp-off requests awaiting the viewer's approval. HR_ADMIN and SUPER_ADMIN
   * see every pending request; everyone else sees what the approval engine
   * says they can act on now.
   */
  async getPendingApprovals(actor: AuthenticatedUser) {
    const where: Prisma.CompOffRequestWhereInput = {
      tenantId: actor.tenantId,
      status: 'PENDING',
    };

    if (actor.role !== UserRole.HR_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      const ids = await this.workflow.listActionableEntityIds(actor, WorkflowEntityType.COMP_OFF);
      where.id = { in: ids };
    }

    return this.prisma.compOffRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: { select: { name: true } },
          },
        },
      },
    });
  }

  /**
   * Approve a comp-off request. Authorization comes from the approval engine;
   * on the last step the transition and the balance credit run inside its
   * transaction. On an intermediate step the request stays PENDING.
   */
  async approve(actor: AuthenticatedUser, id: string, dto: ApproveCompOffDto = {}) {
    const tenantId = actor.tenantId;
    const approverId = actor.employeeId ?? null;

    const request = await this.prisma.compOffRequest.findFirst({
      where: { id, tenantId, status: 'PENDING' },
    });

    if (!request) {
      throw new NotFoundException(
        'Comp-off request not found or already processed',
      );
    }

    // Crediting a comp-off that has already lapsed hands the employee a day the
    // policy says they no longer have. The expiry was recorded at creation but
    // nothing checked it, so a slow approval silently revived it.
    if (request.expiryDate && new Date(request.expiryDate) < new Date()) {
      throw new BadRequestException(
        `This comp-off expired on ${new Date(request.expiryDate).toLocaleDateString()} and can no longer be approved.`,
      );
    }

    const final: { row?: CompOffWithRelations } = {};
    const result = await this.workflow.act({
      tenantId,
      entityType: WorkflowEntityType.COMP_OFF,
      entityId: id,
      actor,
      decision: 'APPROVE',
      note: dto.approverNote ?? null,
      // The status-guarded transition and the balance credit are one unit: if
      // the credit fails after the row is already APPROVED, the employee loses
      // the earned day and a retry is refused because it is no longer PENDING.
      onFinal: async (tx) => {
        final.row = await this.transitionPending(tx, id, {
          status: 'APPROVED',
          approverId,
          approverNote: dto.approverNote,
          approvedAt: new Date(),
        });

        await this.creditCompOffBalance(
          tx,
          tenantId,
          request.employeeId,
          Number(request.earnedDays),
        );
      },
    });

    if (result.outcome === 'ADVANCED' || !final.row) {
      return this.findWithRelations(tenantId, id);
    }

    // Notify the employee
    this.notificationsService
      .notifyEmployee(
        tenantId,
        request.employeeId,
        NotificationType.COMP_OFF_APPROVED,
        'Comp-Off Approved',
        `Your comp-off request for ${new Date(request.workedDate).toLocaleDateString()} (${request.earnedDays} day(s)) has been approved.`,
        '/leave/comp-off',
      )
      .catch(() => {}); // Fire and forget

    return final.row;
  }

  /**
   * Reject a comp-off request. Authorization comes from the approval engine.
   */
  async reject(actor: AuthenticatedUser, id: string, dto: ApproveCompOffDto = {}) {
    const tenantId = actor.tenantId;
    const approverId = actor.employeeId ?? null;

    const request = await this.prisma.compOffRequest.findFirst({
      where: { id, tenantId, status: 'PENDING' },
    });

    if (!request) {
      throw new NotFoundException(
        'Comp-off request not found or already processed',
      );
    }

    const final: { row?: CompOffWithRelations } = {};
    const result = await this.workflow.act({
      tenantId,
      entityType: WorkflowEntityType.COMP_OFF,
      entityId: id,
      actor,
      decision: 'REJECT',
      note: dto.approverNote ?? null,
      onFinal: async (tx) => {
        final.row = await this.transitionPending(tx, id, {
          status: 'REJECTED',
          approverId,
          approverNote: dto.approverNote,
        });
      },
    });

    if (result.outcome === 'ADVANCED' || !final.row) {
      return this.findWithRelations(tenantId, id);
    }

    // Notify the employee
    this.notificationsService
      .notifyEmployee(
        tenantId,
        request.employeeId,
        NotificationType.COMP_OFF_REJECTED,
        'Comp-Off Rejected',
        `Your comp-off request for ${new Date(request.workedDate).toLocaleDateString()} has been rejected.${dto.approverNote ? ' Note: ' + dto.approverNote : ''}`,
        '/leave/comp-off',
      )
      .catch(() => {}); // Fire and forget

    return final.row;
  }


  /** Reload a request in the shape the approve/reject endpoints return. */
  private async findWithRelations(tenantId: string, id: string) {
    const row = await this.prisma.compOffRequest.findFirst({
      where: { id, tenantId },
      include: COMP_OFF_RELATIONS,
    });
    if (!row) {
      throw new NotFoundException('Comp-off request not found');
    }
    return row;
  }

  /**
   * Get all comp-off requests (Admin view)
   */
  async getAllRequests(tenantId: string, query: CompOffQueryDto) {
    const { status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };

    if (status) {
      where.status = status;
    }

    const [requests, total] = await Promise.all([
      this.prisma.compOffRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: { select: { name: true } },
            },
          },
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.compOffRequest.count({ where }),
    ]);

    return {
      data: requests,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Move a PENDING comp-off request to a terminal status.
   * The where-clause includes the status, so if a concurrent reviewer already
   * transitioned the row, Prisma raises P2025 and we surface a 409 instead of
   * applying the side effects twice.
   */
  private async transitionPending(
    client: PrismaClientLike,
    id: string,
    data: {
      status: 'APPROVED' | 'REJECTED';
      approverId: string | null;
      approverNote?: string;
      approvedAt?: Date;
    },
  ): Promise<CompOffWithRelations> {
    try {
      return await client.compOffRequest.update({
        where: { id, status: 'PENDING' },
        data,
        include: COMP_OFF_RELATIONS,
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException('Comp-off request has already been processed');
      }
      throw err;
    }
  }

  /**
   * Credit comp-off balance to employee's leave balance
   * Finds or creates a COMP_OFF leave type, then increments the balance
   */
  private async creditCompOffBalance(
    client: PrismaClientLike,
    tenantId: string,
    employeeId: string,
    earnedDays: number,
  ) {
    // Find the COMP_OFF leave type
    let compOffType = await client.leaveType.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: 'COMP_OFF',
        },
      },
    });

    // If COMP_OFF leave type doesn't exist, create it
    if (!compOffType) {
      compOffType = await client.leaveType.create({
        data: {
          tenantId,
          name: 'Compensatory Off',
          code: 'COMP_OFF',
          description: 'Compensatory leave for working on holidays/weekends',
          defaultDays: 0,
          carryForward: false,
          isPaid: true,
        },
      });
    }

    const currentYear = new Date().getFullYear();

    // Find or create leave balance
    const balance = await client.leaveBalance.findFirst({
      where: {
        tenantId,
        employeeId,
        leaveTypeId: compOffType.id,
        year: currentYear,
      },
    });

    if (balance) {
      await client.leaveBalance.update({
        where: { id: balance.id },
        data: {
          totalDays: { increment: earnedDays },
        },
      });
    } else {
      await client.leaveBalance.create({
        data: {
          tenantId,
          employeeId,
          leaveTypeId: compOffType.id,
          year: currentYear,
          totalDays: earnedDays,
          usedDays: 0,
          pendingDays: 0,
          carriedOver: 0,
        },
      });
    }
  }
}
