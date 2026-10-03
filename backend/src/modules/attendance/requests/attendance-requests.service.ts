import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AttendanceRequestStatus,
  AttendanceRequestType,
  AttendanceStatus,
  NotificationType,
  Prisma,
  UserRole,
  WorkflowEntityType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApprovalEngineService } from '../../workflow/approval-engine.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { findUserIdForEmployee } from '../../workflow/workflow.utils';
import {
  WorkflowEntityContext,
  WorkflowEntitySummary,
} from '../../workflow/workflow.types';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import {
  isPrismaError,
  PRISMA_RECORD_NOT_FOUND,
} from '../../../common/utils/prisma-errors';
import { DEFAULT_ATTENDANCE_TIME_ZONE, zonedDateOnlyUtc } from '../rules/late-mark';
import { previousDateOnly } from '../rules/overnight-shift';
import type { CoveringRequest } from './attendance-requests.types';
import {
  AllAttendanceRequestsQueryDto,
  CreateAttendanceRequestDto,
  MyAttendanceRequestsQueryDto,
} from './dto/attendance-request.dto';

const MS_PER_DAY = 86_400_000;
const MAX_RANGE_DAYS = 31;
const MAX_BACKDATE_DAYS = 30;
const MAX_PAGE_SIZE = 100;
const NO_EMPLOYEE = 'No employee record linked to this user';
const ALREADY_PROCESSED = 'This request has already been processed';

const EMPLOYEE_SELECT = {
  select: { id: true, firstName: true, lastName: true, employeeCode: true },
} as const;

type RequestWithEmployee = Prisma.AttendanceRequestGetPayload<{
  include: { employee: typeof EMPLOYEE_SELECT };
}>;

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const toDateOnly = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;

const entityTypeFor = (type: AttendanceRequestType): WorkflowEntityType =>
  type === AttendanceRequestType.WFH
    ? WorkflowEntityType.WFH_REQUEST
    : WorkflowEntityType.ON_DUTY_REQUEST;

const dayStatusFor = (type: AttendanceRequestType): AttendanceStatus =>
  type === AttendanceRequestType.WFH ? AttendanceStatus.WFH : AttendanceStatus.ON_DUTY;

const titleFor = (type: AttendanceRequestType) =>
  type === AttendanceRequestType.WFH ? 'Work from home' : 'On duty';

/**
 * WFH and on-duty requests (Keka wave G, WS-A). An approved request covers an
 * employee's dates: the punch rules read it through `findApprovedCovering` to
 * waive the IP and geofence checks and to stamp the day WFH / ON_DUTY.
 */
@Injectable()
export class AttendanceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApprovalEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  private today(): Date {
    return zonedDateOnlyUtc(new Date(), DEFAULT_ATTENDANCE_TIME_ZONE);
  }

  private requireEmployeeId(actor: AuthenticatedUser): string {
    if (!actor.employeeId) throw new BadRequestException(NO_EMPLOYEE);
    return actor.employeeId;
  }

  async create(actor: AuthenticatedUser, dto: CreateAttendanceRequestDto) {
    const tenantId = actor.tenantId;
    const employeeId = this.requireEmployeeId(actor);

    const fromDate = toDateOnly(dto.fromDate);
    const toDate = toDateOnly(dto.toDate);
    if (fromDate > toDate) {
      throw new BadRequestException('fromDate must not be after toDate');
    }
    const days = daysBetween(fromDate, toDate);
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(`A request can span at most ${MAX_RANGE_DAYS} days`);
    }
    const today = this.today();
    const earliest = new Date(today.getTime() - MAX_BACKDATE_DAYS * MS_PER_DAY);
    if (fromDate < earliest) {
      throw new BadRequestException(
        `A request cannot start more than ${MAX_BACKDATE_DAYS} days in the past`,
      );
    }
    if (dto.location && dto.type !== AttendanceRequestType.ON_DUTY) {
      throw new BadRequestException('Location is only accepted for on-duty requests');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!employee) {
      throw new BadRequestException('Employee not found or inactive');
    }

    const overlap = await this.prisma.attendanceRequest.findFirst({
      where: {
        tenantId,
        employeeId,
        status: { in: [AttendanceRequestStatus.PENDING, AttendanceRequestStatus.APPROVED] },
        fromDate: { lte: toDate },
        toDate: { gte: fromDate },
      },
      select: { id: true },
    });
    if (overlap) {
      throw new ConflictException(
        'You already have a pending or approved request overlapping these dates',
      );
    }

    const entityType = entityTypeFor(dto.type);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.attendanceRequest.create({
        data: {
          tenantId,
          employeeId,
          type: dto.type,
          fromDate,
          toDate,
          days,
          reason: dto.reason,
          location: dto.location ?? null,
          status: AttendanceRequestStatus.PENDING,
        },
        include: { employee: EMPLOYEE_SELECT },
      });
      await this.workflow.start({
        tenantId,
        entityType,
        entityId: row.id,
        context: {
          requesterEmployeeId: employeeId,
          requesterUserId: actor.userId,
          days,
        },
        tx,
      });
      return row;
    });

    void this.workflow.notifyPending(tenantId, entityType, created.id);
    return created;
  }

  async listMine(actor: AuthenticatedUser, q: MyAttendanceRequestsQueryDto = {}) {
    const employeeId = this.requireEmployeeId(actor);
    const where: Prisma.AttendanceRequestWhereInput = {
      tenantId: actor.tenantId,
      employeeId,
      ...this.filters(q),
    };
    return this.prisma.attendanceRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Requests awaiting the viewer. HR_ADMIN and SUPER_ADMIN see every pending
   * request; everyone else sees what the approval engine says they can act on.
   */
  async listPendingApprovals(actor: AuthenticatedUser) {
    const where: Prisma.AttendanceRequestWhereInput = {
      tenantId: actor.tenantId,
      status: AttendanceRequestStatus.PENDING,
    };
    if (actor.role !== UserRole.HR_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      const [wfhIds, onDutyIds] = await Promise.all([
        this.workflow.listActionableEntityIds(actor, WorkflowEntityType.WFH_REQUEST),
        this.workflow.listActionableEntityIds(actor, WorkflowEntityType.ON_DUTY_REQUEST),
      ]);
      where.id = { in: [...wfhIds, ...onDutyIds] };
    }
    return this.prisma.attendanceRequest.findMany({
      where,
      include: { employee: EMPLOYEE_SELECT },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAll(tenantId: string, q: AllAttendanceRequestsQueryDto = {}) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(q.limit) || 20));
    const where: Prisma.AttendanceRequestWhereInput = {
      tenantId,
      ...this.filters(q),
    };
    if (q.type) where.type = q.type;
    if (q.employeeId) where.employeeId = q.employeeId;

    const [data, total] = await Promise.all([
      this.prisma.attendanceRequest.findMany({
        where,
        include: { employee: EMPLOYEE_SELECT },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.attendanceRequest.count({ where }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  /** Status filter plus "overlaps [from, to]" for the date filters. */
  private filters(q: {
    status?: AttendanceRequestStatus;
    from?: string;
    to?: string;
  }): Prisma.AttendanceRequestWhereInput {
    const where: Prisma.AttendanceRequestWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.to) where.fromDate = { lte: toDateOnly(q.to) };
    if (q.from) where.toDate = { gte: toDateOnly(q.from) };
    return where;
  }

  async approve(actor: AuthenticatedUser, id: string, note?: string | null) {
    const tenantId = actor.tenantId;
    const request = await this.loadPending(tenantId, id);
    const today = this.today();
    const final: { row?: RequestWithEmployee } = {};

    const result = await this.workflow.act({
      tenantId,
      entityType: entityTypeFor(request.type),
      entityId: id,
      actor,
      decision: 'APPROVE',
      note: note ?? null,
      onFinal: async (tx) => {
        final.row = await this.transitionPending(tx, id, {
          status: AttendanceRequestStatus.APPROVED,
          approverId: actor.employeeId ?? null,
          approverNote: note || null,
          decidedAt: new Date(),
        });

        // Days already punched before the approval existed were stored as
        // PRESENT; the approval re-labels them. Other statuses stay as they
        // are, and a day with no record stays without one.
        if (request.fromDate <= today) {
          const upTo = request.toDate < today ? request.toDate : today;
          await tx.attendanceRecord.updateMany({
            where: {
              tenantId,
              employeeId: request.employeeId,
              date: { gte: request.fromDate, lte: upTo },
              status: AttendanceStatus.PRESENT,
            },
            data: { status: dayStatusFor(request.type) },
          });
        }
      },
    });

    if (result.outcome === 'ADVANCED' || !final.row) {
      return this.findOrThrow(tenantId, id);
    }
    await this.notifyRequester(
      request,
      NotificationType.ATTENDANCE_REQUEST_APPROVED,
      `${titleFor(request.type)} request approved`,
      `Your ${titleFor(request.type).toLowerCase()} request for ${fmtDate(request.fromDate)} – ${fmtDate(request.toDate)} has been approved.`,
    );
    return final.row;
  }

  async reject(actor: AuthenticatedUser, id: string, note?: string | null) {
    const tenantId = actor.tenantId;
    const request = await this.loadPending(tenantId, id);
    const final: { row?: RequestWithEmployee } = {};

    const result = await this.workflow.act({
      tenantId,
      entityType: entityTypeFor(request.type),
      entityId: id,
      actor,
      decision: 'REJECT',
      note: note ?? null,
      onFinal: async (tx) => {
        final.row = await this.transitionPending(tx, id, {
          status: AttendanceRequestStatus.REJECTED,
          approverId: actor.employeeId ?? null,
          approverNote: note || null,
          decidedAt: new Date(),
        });
      },
    });

    if (result.outcome === 'ADVANCED' || !final.row) {
      return this.findOrThrow(tenantId, id);
    }
    await this.notifyRequester(
      request,
      NotificationType.ATTENDANCE_REQUEST_REJECTED,
      `${titleFor(request.type)} request rejected`,
      `Your ${titleFor(request.type).toLowerCase()} request for ${fmtDate(request.fromDate)} – ${fmtDate(request.toDate)} has been rejected.${note ? ` Note: ${note}` : ''}`,
    );
    return final.row;
  }

  /**
   * Requester-only. PENDING cancels outright. APPROVED cancels the part that
   * has not happened yet: past days are never un-marked.
   */
  async cancel(actor: AuthenticatedUser, id: string) {
    const tenantId = actor.tenantId;
    const employeeId = this.requireEmployeeId(actor);
    const request = await this.prisma.attendanceRequest.findFirst({
      where: { id, tenantId, employeeId },
    });
    if (!request) throw new NotFoundException('Request not found');

    const today = this.today();
    const entityType = entityTypeFor(request.type);

    let where: Prisma.AttendanceRequestWhereUniqueInput;
    let data: Prisma.AttendanceRequestUpdateInput;
    if (request.status === AttendanceRequestStatus.PENDING) {
      where = { id, status: AttendanceRequestStatus.PENDING };
      data = { status: AttendanceRequestStatus.CANCELLED, cancelledAt: new Date() };
    } else if (request.status === AttendanceRequestStatus.APPROVED) {
      if (request.toDate < today) {
        throw new BadRequestException('A request that is fully in the past cannot be cancelled');
      }
      where = { id, status: AttendanceRequestStatus.APPROVED };
      if (request.fromDate >= today) {
        data = { status: AttendanceRequestStatus.CANCELLED, cancelledAt: new Date() };
      } else {
        const yesterday = previousDateOnly(today);
        data = { toDate: yesterday, days: daysBetween(request.fromDate, yesterday) };
      }
    } else {
      throw new BadRequestException(`A ${request.status.toLowerCase()} request cannot be cancelled`);
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.attendanceRequest.update({ where, data });
        if (request.status === AttendanceRequestStatus.PENDING) {
          await this.workflow.cancel(tenantId, entityType, id, tx);
        }
        return row;
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException(ALREADY_PROCESSED);
      }
      throw err;
    }
  }

  /** The APPROVED request whose dates cover `date` for the employee, or null. */
  async findApprovedCovering(
    tenantId: string,
    employeeId: string,
    date: Date,
    tx?: Prisma.TransactionClient,
  ): Promise<CoveringRequest | null> {
    const db = tx ?? this.prisma;
    return db.attendanceRequest.findFirst({
      where: {
        tenantId,
        employeeId,
        status: AttendanceRequestStatus.APPROVED,
        fromDate: { lte: date },
        toDate: { gte: date },
      },
      select: { id: true, type: true },
    });
  }

  /** Workflow-inbox summaries for rows of `type` (rows of the other type are skipped). */
  async describe(
    tenantId: string,
    ids: string[],
    type: AttendanceRequestType,
  ): Promise<WorkflowEntitySummary[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.attendanceRequest.findMany({
      where: { tenantId, id: { in: ids }, type },
      include: { employee: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((row) => ({
      entityId: row.id,
      title: titleFor(row.type),
      subtitle: `${fmtDate(row.fromDate)} – ${fmtDate(row.toDate)} (${row.days} day${row.days === 1 ? '' : 's'})`,
      requesterName: `${row.employee.firstName} ${row.employee.lastName}`,
      link: '/approvals/attendance-requests',
      submittedAt: row.createdAt.toISOString(),
    }));
  }

  /** Approval-engine context; null unless the row is a PENDING request of `type`. */
  async getContext(
    tenantId: string,
    id: string,
    type: AttendanceRequestType,
  ): Promise<WorkflowEntityContext | null> {
    const row = await this.prisma.attendanceRequest.findFirst({
      where: { id, tenantId, type, status: AttendanceRequestStatus.PENDING },
      select: { employeeId: true, days: true },
    });
    if (!row) return null;
    return {
      requesterEmployeeId: row.employeeId,
      requesterUserId: await findUserIdForEmployee(this.prisma, tenantId, row.employeeId),
      days: row.days,
    };
  }

  private async loadPending(tenantId: string, id: string) {
    const request = await this.prisma.attendanceRequest.findFirst({
      where: { id, tenantId },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (request.status !== AttendanceRequestStatus.PENDING) {
      throw new BadRequestException(ALREADY_PROCESSED);
    }
    return request;
  }

  private async findOrThrow(tenantId: string, id: string) {
    const row = await this.prisma.attendanceRequest.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Request not found');
    return row;
  }

  /** PENDING → terminal, guarded on status so a concurrent reviewer gets 409. */
  private async transitionPending(
    tx: Prisma.TransactionClient,
    id: string,
    data: {
      status: AttendanceRequestStatus;
      approverId: string | null;
      approverNote: string | null;
      decidedAt: Date;
    },
  ) {
    try {
      return await tx.attendanceRequest.update({
        where: { id, status: AttendanceRequestStatus.PENDING },
        data,
        include: { employee: EMPLOYEE_SELECT },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException(ALREADY_PROCESSED);
      }
      throw err;
    }
  }

  /** Best effort: a failed notification never fails the decision (it never throws). */
  private async notifyRequester(
    request: { tenantId: string; employeeId: string },
    type: NotificationType,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      const userId = await findUserIdForEmployee(
        this.prisma,
        request.tenantId,
        request.employeeId,
      );
      if (!userId) return;
      await this.notifications.create({
        tenantId: request.tenantId,
        userId,
        type,
        title,
        message,
        link: '/attendance/requests',
      });
    } catch {
      // best effort
    }
  }
}
