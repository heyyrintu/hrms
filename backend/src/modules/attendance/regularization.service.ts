import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from '../../common/utils/prisma-errors';
import { NotificationsService } from '../notifications/notifications.service';
import { OtCalculationService } from './ot-calculation.service';
import {
  CreateRegularizationDto,
  ApproveRegularizationDto,
  RegularizationQueryDto,
} from './dto/regularization.dto';
import {
  AttendanceStatus,
  RegularizationStatus,
  UserRole,
  NotificationType,
  Prisma,
  WorkflowEntityType,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { zonedDateOnlyUtc, DEFAULT_ATTENDANCE_TIME_ZONE } from './rules/late-mark';
import { classifyWorkedDay } from './rules/day-classification';
import { AttendancePolicyService } from './policy/attendance-policy.service';

/** Relations the approve/reject endpoints have always returned. */
const REGULARIZATION_RELATIONS = {
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
} satisfies Prisma.AttendanceRegularizationInclude;

type RegularizationWithRelations = Prisma.AttendanceRegularizationGetPayload<{
  include: typeof REGULARIZATION_RELATIONS;
}>;

@Injectable()
export class RegularizationService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private otCalculation: OtCalculationService,
    private policyService: AttendancePolicyService,
    private workflow: ApprovalEngineService,
  ) {}

  /**
   * Create a regularization request
   */
  async create(
    tenantId: string,
    employeeId: string,
    dto: CreateRegularizationDto,
    requesterUserId?: string | null,
  ) {
    // Same UTC-midnight basis as the clock-in path and the auto-absent sweep,
    // so a regularization request lines up with the attendance row it means.
    const dateOnly = zonedDateOnlyUtc(
      new Date(dto.date),
      DEFAULT_ATTENDANCE_TIME_ZONE,
    );

    // Check if employee exists
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId, status: 'ACTIVE' },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found or inactive');
    }

    // Check for duplicate request
    const existing = await this.prisma.attendanceRegularization.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: dateOnly,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'A regularization request already exists for this date',
      );
    }

    // Fetch original attendance record times (if any)
    const attendanceRecord = await this.prisma.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: dateOnly,
        },
      },
    });

    const userId =
      requesterUserId !== undefined
        ? requesterUserId
        : await this.resolveRequesterUserId(tenantId, employeeId);

    // The request and its approval instance are created together, so a
    // request can never sit PENDING with no chain to route it.
    const regularization = await this.prisma.$transaction(async (tx) => {
      const created = await tx.attendanceRegularization.create({
        data: {
          tenantId,
          employeeId,
          date: dateOnly,
          originalClockIn: attendanceRecord?.clockInTime || null,
          originalClockOut: attendanceRecord?.clockOutTime || null,
          requestedClockIn: new Date(dto.requestedClockIn),
          requestedClockOut: new Date(dto.requestedClockOut),
          reason: dto.reason,
          status: RegularizationStatus.PENDING,
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
        entityType: WorkflowEntityType.REGULARIZATION,
        entityId: created.id,
        context: {
          requesterEmployeeId: employeeId,
          requesterUserId: userId,
          days: null,
        },
        tx,
      });

      return created;
    });

    void this.workflow.notifyPending(
      tenantId,
      WorkflowEntityType.REGULARIZATION,
      regularization.id,
    );

    return regularization;
  }

  /**
   * Get my regularization requests (paginated with optional status filter)
   */
  async getMyRequests(
    tenantId: string,
    employeeId: string,
    query: RegularizationQueryDto,
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      tenantId,
      employeeId,
    };

    if (query.status) {
      where.status = query.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({
        where,
        include: {
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.attendanceRegularization.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Regularizations awaiting the viewer's approval. HR_ADMIN and SUPER_ADMIN
   * see every pending request; everyone else sees what the approval engine
   * says they can act on now.
   */
  async getPendingApprovals(actor: AuthenticatedUser) {
    const where: Prisma.AttendanceRegularizationWhereInput = {
      tenantId: actor.tenantId,
      status: RegularizationStatus.PENDING,
    };

    if (actor.role !== UserRole.HR_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      const ids = await this.workflow.listActionableEntityIds(
        actor,
        WorkflowEntityType.REGULARIZATION,
      );
      where.id = { in: ids };
    }

    return this.prisma.attendanceRegularization.findMany({
      where,
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
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve a regularization request. Authorization comes from the approval
   * engine. On the last step the transition and the rewrite of the attendance
   * record (clock times, OT, status, sessions) run inside its transaction; on
   * an intermediate step the request stays PENDING.
   */
  async approve(
    actor: AuthenticatedUser,
    id: string,
    dto: ApproveRegularizationDto = {},
  ) {
    const tenantId = actor.tenantId;
    const approverId = actor.employeeId ?? null;

    const regularization = await this.prisma.attendanceRegularization.findFirst({
      where: { id, tenantId },
    });

    if (!regularization) {
      throw new NotFoundException('Regularization request not found');
    }

    if (regularization.status !== RegularizationStatus.PENDING) {
      throw new BadRequestException('This request has already been processed');
    }

    // Normalised rather than copied verbatim, so the key matches the clock-in
    // path even if the stored value ever carries a time component.
    const dateOnly = zonedDateOnlyUtc(
      new Date(regularization.date),
      DEFAULT_ATTENDANCE_TIME_ZONE,
    );
    const clockIn = new Date(regularization.requestedClockIn);
    const clockOut = new Date(regularization.requestedClockOut);
    const workedMinutes = Math.max(
      0,
      Math.floor((clockOut.getTime() - clockIn.getTime()) / (1000 * 60)),
    );

    const final: { row?: RegularizationWithRelations } = {};
    const result = await this.workflow.act({
      tenantId,
      entityType: WorkflowEntityType.REGULARIZATION,
      entityId: id,
      actor,
      decision: 'APPROVE',
      note: dto.approverNote ?? null,
      onFinal: async (tx) => {
        // Status-guarded transition: a concurrent approve/reject makes this
        // throw 409 instead of rewriting the attendance record twice.
        final.row = await this.transitionPending(tx, id, {
          status: RegularizationStatus.APPROVED,
          approverId,
          approverNote: dto.approverNote || null,
          approvedAt: new Date(),
        });

        await this.applyRegularization(tx, {
          tenantId,
          employeeId: regularization.employeeId,
          reason: regularization.reason,
          dateOnly,
          clockIn,
          clockOut,
          workedMinutes,
        });
      },
    });

    if (result.outcome === 'ADVANCED' || !final.row) {
      return this.findWithRelations(tenantId, id);
    }

    // Fire-and-forget notification
    this.notificationsService
      .notifyEmployee(
        tenantId,
        regularization.employeeId,
        NotificationType.ATTENDANCE_REGULARIZATION_APPROVED,
        'Regularization Approved',
        `Your attendance regularization request for ${dateOnly.toLocaleDateString()} has been approved.`,
        '/attendance/regularization',
      )
      .catch(() => {}); // Fire and forget

    return final.row;
  }

  /**
   * Reject a regularization request. Authorization comes from the approval engine.
   */
  async reject(
    actor: AuthenticatedUser,
    id: string,
    dto: ApproveRegularizationDto = {},
  ) {
    const tenantId = actor.tenantId;
    const approverId = actor.employeeId ?? null;

    const regularization = await this.prisma.attendanceRegularization.findFirst({
      where: { id, tenantId },
    });

    if (!regularization) {
      throw new NotFoundException('Regularization request not found');
    }

    if (regularization.status !== RegularizationStatus.PENDING) {
      throw new BadRequestException('This request has already been processed');
    }

    const final: { row?: RegularizationWithRelations } = {};
    const result = await this.workflow.act({
      tenantId,
      entityType: WorkflowEntityType.REGULARIZATION,
      entityId: id,
      actor,
      decision: 'REJECT',
      note: dto.approverNote ?? null,
      onFinal: async (tx) => {
        final.row = await this.transitionPending(tx, id, {
          status: RegularizationStatus.REJECTED,
          approverId,
          approverNote: dto.approverNote || null,
          approvedAt: new Date(),
        });
      },
    });

    if (result.outcome === 'ADVANCED' || !final.row) {
      return this.findWithRelations(tenantId, id);
    }

    // Fire-and-forget notification
    this.notificationsService
      .notifyEmployee(
        tenantId,
        regularization.employeeId,
        NotificationType.ATTENDANCE_REGULARIZATION_REJECTED,
        'Regularization Rejected',
        `Your attendance regularization request for ${new Date(regularization.date).toLocaleDateString()} has been rejected.${dto.approverNote ? ` Note: ${dto.approverNote}` : ''}`,
        '/attendance/regularization',
      )
      .catch(() => {}); // Fire and forget

    return final.row;
  }

  /**
   * The user account linked to an employee, used as the requester for the
   * self-approval rule. Null when the employee has no login.
   */
  async resolveRequesterUserId(tenantId: string, employeeId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, employeeId },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /**
   * Rewrite the day's attendance record to the approved clock times. Runs in
   * the approval's transaction so the record and the request never disagree.
   */
  private async applyRegularization(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      employeeId: string;
      reason: string;
      dateOnly: Date;
      clockIn: Date;
      clockOut: Date;
      workedMinutes: number;
    },
  ) {
    const { tenantId, employeeId, reason, dateOnly, clockIn, clockOut, workedMinutes } = input;

    const existingAttendance = await tx.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: dateOnly,
        },
      },
    });

    const standardWorkMinutes = existingAttendance?.standardWorkMinutes ?? 480;

    // Overtime has to follow the corrected hours. Leaving the previous value
    // means a regularized ten-hour day never surfaces for OT approval.
    const employee = await tx.employee.findFirst({
      where: { id: employeeId, tenantId },
      select: { employmentType: true },
    });
    const otRule = employee
      ? await this.otCalculation.getOtRule(tenantId, employee.employmentType)
      : null;
    const otMinutesCalculated = this.otCalculation.calculateOtMinutes(
      workedMinutes,
      standardWorkMinutes,
      otRule,
    );

    // The corrected hours are scored exactly as a clock-out would score them,
    // so regularizing a two-hour day cannot turn it into a paid full day. The
    // approval itself asserts presence, so the base is PRESENT (or WFH, when
    // the day was already a work-from-home day) whatever the row said before.
    const policy = await this.policyService.getOrCreate(tenantId);
    const baseStatus: AttendanceStatus =
      existingAttendance?.status === AttendanceStatus.WFH
        ? AttendanceStatus.WFH
        : AttendanceStatus.PRESENT;
    const status = classifyWorkedDay(workedMinutes, baseStatus, policy) ?? baseStatus;

    let attendanceId: string;
    if (existingAttendance) {
      // Update existing attendance record
      await tx.attendanceRecord.update({
        where: { id: existingAttendance.id },
        data: {
          clockInTime: clockIn,
          clockOutTime: clockOut,
          workedMinutes,
          otMinutesCalculated,
          status,
          // The approver has settled the day; nothing left to restore.
          preClassificationStatus: null,
        },
      });
      attendanceId = existingAttendance.id;
    } else {
      // Create a new attendance record
      const created = await tx.attendanceRecord.create({
        data: {
          tenantId,
          employeeId,
          date: dateOnly,
          clockInTime: clockIn,
          clockOutTime: clockOut,
          workedMinutes,
          otMinutesCalculated,
          status,
          source: 'API',
          standardWorkMinutes,
          remarks: `Regularized: ${reason}`,
        },
      });
      attendanceId = created.id;
    }

    // Sessions would otherwise still describe the original punches and
    // contradict the corrected clock times on the parent record.
    await tx.attendanceSession.deleteMany({ where: { attendanceId } });
    await tx.attendanceSession.create({
      data: {
        tenantId,
        attendanceId,
        inTime: clockIn,
        outTime: clockOut,
        sessionMinutes: workedMinutes,
      },
    });
  }

  /** Reload a request in the shape the approve/reject endpoints return. */
  private async findWithRelations(tenantId: string, id: string) {
    const row = await this.prisma.attendanceRegularization.findFirst({
      where: { id, tenantId },
      include: REGULARIZATION_RELATIONS,
    });
    if (!row) {
      throw new NotFoundException('Regularization request not found');
    }
    return row;
  }

  /**
   * Move a PENDING regularization to a terminal status. The where-clause
   * includes the status so a concurrent reviewer cannot transition it twice;
   * Prisma raises P2025 when the row no longer matches.
   */
  private async transitionPending(
    tx: Prisma.TransactionClient,
    id: string,
    data: {
      status: RegularizationStatus;
      approverId: string | null;
      approverNote: string | null;
      approvedAt: Date;
    },
  ): Promise<RegularizationWithRelations> {
    try {
      return await tx.attendanceRegularization.update({
        where: { id, status: RegularizationStatus.PENDING },
        data,
        include: REGULARIZATION_RELATIONS,
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException('This request has already been processed');
      }
      throw err;
    }
  }

  /**
   * Get all regularization requests (admin view)
   */
  async getAllRequests(tenantId: string, query: RegularizationQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };

    if (query.status) {
      where.status = query.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({
        where,
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
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.attendanceRegularization.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
