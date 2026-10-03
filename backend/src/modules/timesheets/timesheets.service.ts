import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  NotificationType,
  Prisma,
  TimesheetStatus,
  UserRole,
  WorkflowEntityType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from '../../common/utils/prisma-errors';
import { DEFAULT_ATTENDANCE_TIME_ZONE, zonedDateOnlyUtc } from '../attendance/rules/late-mark';
import { findUserIdForEmployee } from '../workflow/workflow.utils';
import { assertMonday, isoDate, parseDateOnly, toHours, weekEnd } from './timesheet-week';
import { AllTimesheetsQueryDto, SaveTimesheetEntriesDto } from './dto/timesheet.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;
const MAX_DAY_HOURS = new Prisma.Decimal(24);

const ENTRY_RELATIONS = {
  project: { select: { id: true, code: true, name: true } },
  task: { select: { id: true, name: true } },
} satisfies Prisma.TimesheetEntryInclude;

const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  managerId: true,
} satisfies Prisma.EmployeeSelect;

const isHr = (actor: AuthenticatedUser) =>
  actor.role === UserRole.HR_ADMIN || actor.role === UserRole.SUPER_ADMIN;

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** An entry as the validator sees it, whether freshly posted or read back. */
interface CandidateEntry {
  date: Date;
  projectId: string;
  taskId: string | null;
  hours: Prisma.Decimal;
}

type Validation =
  | { ok: true; billable: boolean[] }
  | { ok: false; errors: string[] };

type Db = Prisma.TransactionClient;

@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApprovalEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------- my week

  /** The caller's week: the timesheet (or null), its entries, and attended minutes. */
  async getMyWeek(actor: AuthenticatedUser, weekStart: Date) {
    const employeeId = this.requireEmployee(actor);
    assertMonday(weekStart);
    const tenantId = actor.tenantId;

    const [timesheet, attendance] = await Promise.all([
      this.prisma.timesheet.findUnique({
        where: { tenantId_employeeId_weekStart: { tenantId, employeeId, weekStart } },
        include: { entries: { include: ENTRY_RELATIONS, orderBy: { date: 'asc' } } },
      }),
      this.prisma.attendanceRecord.findMany({
        where: {
          tenantId,
          employeeId,
          date: { gte: weekStart, lte: weekEnd(weekStart) },
        },
        select: { date: true, workedMinutes: true },
      }),
    ]);

    const attendedMinutesByDate: Record<string, number> = {};
    for (const row of attendance) {
      attendedMinutesByDate[isoDate(row.date)] = row.workedMinutes ?? 0;
    }

    if (!timesheet) {
      return { timesheet: null, entries: [], attendedMinutesByDate };
    }
    return {
      timesheet: serializeTimesheet(timesheet),
      entries: (timesheet.entries ?? []).map(serializeEntry),
      attendedMinutesByDate,
    };
  }

  /** The caller's timesheet summaries, newest week first. */
  async listMine(actor: AuthenticatedUser, from?: Date, to?: Date) {
    const employeeId = this.requireEmployee(actor);
    const weekStart: Prisma.DateTimeFilter = {};
    if (from) weekStart.gte = from;
    if (to) weekStart.lte = to;

    const rows = await this.prisma.timesheet.findMany({
      where: {
        tenantId: actor.tenantId,
        employeeId,
        ...(from || to ? { weekStart } : {}),
      },
      orderBy: { weekStart: 'desc' },
    });
    return rows.map(serializeTimesheet);
  }

  // ----------------------------------------------------------------- save

  /**
   * Replace the week's entries. Allowed while the timesheet is absent, DRAFT
   * or REJECTED (a REJECTED one stays REJECTED until it is submitted).
   */
  async saveEntries(actor: AuthenticatedUser, weekStart: Date, dto: SaveTimesheetEntriesDto) {
    const employeeId = this.requireEmployee(actor);
    assertMonday(weekStart);
    const tenantId = actor.tenantId;

    const today = zonedDateOnlyUtc(new Date(), DEFAULT_ATTENDANCE_TIME_ZONE);
    if (weekStart.getTime() > today.getTime() + 7 * DAY_MS) {
      throw new BadRequestException('Timesheets cannot be saved more than one week in the future');
    }
    if (dto.entries.length > MAX_ENTRIES) {
      throw new BadRequestException(`A timesheet holds at most ${MAX_ENTRIES} entries`);
    }

    const candidates = this.toCandidates(weekStart, dto);

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.timesheet.findUnique({
        where: { tenantId_employeeId_weekStart: { tenantId, employeeId, weekStart } },
        select: { id: true, status: true },
      });
      if (
        existing &&
        existing.status !== TimesheetStatus.DRAFT &&
        existing.status !== TimesheetStatus.REJECTED
      ) {
        throw new BadRequestException(
          `A ${existing.status.toLowerCase()} timesheet cannot be edited`,
        );
      }

      const checked = await this.validateEntries(tx, tenantId, employeeId, weekStart, candidates);
      if (!checked.ok) throw new BadRequestException(checked.errors.join('; '));

      const total = candidates.reduce((sum, e) => sum.plus(e.hours), new Prisma.Decimal(0));
      // Creates the row when absent; an existing row is changed only by the
      // status-guarded updateMany below (a REJECTED timesheet stays REJECTED).
      const sheet = await tx.timesheet.upsert({
        where: { tenantId_employeeId_weekStart: { tenantId, employeeId, weekStart } },
        create: {
          tenantId,
          employeeId,
          weekStart,
          status: TimesheetStatus.DRAFT,
          totalHours: total,
        },
        update: {},
      });

      // The guard doubles as a row lock: a concurrent submit or save makes this
      // wait, then match nothing, so entries are never replaced under it.
      const guarded = await tx.timesheet.updateMany({
        where: {
          id: sheet.id,
          tenantId,
          status: { in: [TimesheetStatus.DRAFT, TimesheetStatus.REJECTED] },
        },
        data: { totalHours: total },
      });
      if (guarded.count === 0) {
        throw new ConflictException('This timesheet was changed by another request; reload and retry');
      }

      await tx.timesheetEntry.deleteMany({ where: { timesheetId: sheet.id } });
      if (candidates.length > 0) {
        await tx.timesheetEntry.createMany({
          data: candidates.map((e, i) => ({
            tenantId,
            timesheetId: sheet.id,
            date: e.date,
            projectId: e.projectId,
            taskId: e.taskId,
            hours: e.hours,
            billable: checked.billable[i],
            note: dto.entries[i].note ?? null,
          })),
        });
      }
    });

    return this.getMyWeek(actor, weekStart);
  }

  // --------------------------------------------------------------- submit

  /** Submit a DRAFT or REJECTED timesheet into the approval workflow. */
  async submit(actor: AuthenticatedUser, id: string) {
    const employeeId = this.requireEmployee(actor);
    const tenantId = actor.tenantId;

    const sheet = await this.prisma.timesheet.findFirst({
      where: { id, tenantId, employeeId },
      include: { entries: true },
    });
    if (!sheet) throw new NotFoundException('Timesheet not found');

    if (sheet.status !== TimesheetStatus.DRAFT && sheet.status !== TimesheetStatus.REJECTED) {
      throw new BadRequestException(`A ${sheet.status.toLowerCase()} timesheet cannot be submitted`);
    }
    const today = zonedDateOnlyUtc(new Date(), DEFAULT_ATTENDANCE_TIME_ZONE);
    if (sheet.weekStart.getTime() > today.getTime()) {
      throw new BadRequestException('This week has not started yet; it cannot be submitted');
    }
    if (sheet.entries.length === 0) {
      throw new BadRequestException('The timesheet has no entries to submit');
    }

    const candidates: CandidateEntry[] = sheet.entries.map((e) => ({
      date: e.date,
      projectId: e.projectId,
      taskId: e.taskId,
      hours: new Prisma.Decimal(e.hours),
    }));

    const submitted = await this.prisma.$transaction(async (tx) => {
      // Membership, project state or tasks may have changed since saving.
      const checked = await this.validateEntries(
        tx,
        tenantId,
        employeeId,
        sheet.weekStart,
        candidates,
      );
      if (!checked.ok) throw new BadRequestException(checked.errors.join('; '));

      let row;
      try {
        row = await tx.timesheet.update({
          where: {
            id,
            status: { in: [TimesheetStatus.DRAFT, TimesheetStatus.REJECTED] },
          },
          data: {
            status: TimesheetStatus.SUBMITTED,
            submittedAt: new Date(),
            decidedAt: null,
            approverId: null,
            approverNote: null,
          },
        });
      } catch (err) {
        if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
          throw new ConflictException('This timesheet has already been submitted');
        }
        throw err;
      }

      // Restarting is what opens round N+1 after a rejection.
      await this.workflow.start({
        tenantId,
        entityType: WorkflowEntityType.TIMESHEET,
        entityId: id,
        context: {
          requesterEmployeeId: employeeId,
          requesterUserId: actor.userId,
          days: null,
        },
        tx,
      });
      return row;
    });

    void this.workflow.notifyPending(tenantId, WorkflowEntityType.TIMESHEET, id);
    return serializeTimesheet(submitted);
  }

  // --------------------------------------------------------------- recall

  /** Pull a SUBMITTED timesheet back to DRAFT and cancel its approval. */
  async recall(actor: AuthenticatedUser, id: string) {
    const employeeId = this.requireEmployee(actor);
    const tenantId = actor.tenantId;

    const sheet = await this.prisma.timesheet.findFirst({
      where: { id, tenantId, employeeId },
    });
    if (!sheet) throw new NotFoundException('Timesheet not found');
    if (sheet.status !== TimesheetStatus.SUBMITTED) {
      throw new BadRequestException('Only a submitted timesheet can be recalled');
    }

    const recalled = await this.prisma.$transaction(async (tx) => {
      let row;
      try {
        row = await tx.timesheet.update({
          where: { id, status: TimesheetStatus.SUBMITTED },
          data: { status: TimesheetStatus.DRAFT, submittedAt: null },
        });
      } catch (err) {
        if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
          throw new ConflictException('This timesheet has already been processed');
        }
        throw err;
      }
      await this.workflow.cancel(tenantId, WorkflowEntityType.TIMESHEET, id, tx);
      return row;
    });

    return serializeTimesheet(recalled);
  }

  // ------------------------------------------------------ approve / reject

  /** Approve through the approval engine; the final step moves SUBMITTED to APPROVED. */
  approve(actor: AuthenticatedUser, id: string, note?: string | null) {
    return this.decide(actor, id, 'APPROVE', note);
  }

  /** Reject through the approval engine; the final step moves SUBMITTED to REJECTED. */
  reject(actor: AuthenticatedUser, id: string, note?: string | null) {
    return this.decide(actor, id, 'REJECT', note);
  }

  private async decide(
    actor: AuthenticatedUser,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    note?: string | null,
  ) {
    const tenantId = actor.tenantId;
    const sheet = await this.prisma.timesheet.findFirst({ where: { id, tenantId } });
    if (!sheet) throw new NotFoundException('Timesheet not found');
    if (sheet.status !== TimesheetStatus.SUBMITTED) {
      throw new BadRequestException('This timesheet has already been processed');
    }

    const approving = decision === 'APPROVE';
    const final: { row?: Awaited<ReturnType<TimesheetsService['transitionSubmitted']>> } = {};
    const result = await this.workflow.act({
      tenantId,
      entityType: WorkflowEntityType.TIMESHEET,
      entityId: id,
      actor,
      decision,
      note: note ?? null,
      onFinal: async (tx) => {
        // Status-guarded: a concurrent decision makes this 409, not a second write.
        final.row = await this.transitionSubmitted(tx, id, {
          status: approving ? TimesheetStatus.APPROVED : TimesheetStatus.REJECTED,
          decidedAt: new Date(),
          approverId: actor.employeeId ?? null,
          approverNote: note || null,
        });
      },
    });

    if (result.outcome === 'ADVANCED' || !final.row) {
      return this.findForResponse(tenantId, id);
    }

    await this.notifyOwner(sheet, approving, note);
    return serializeTimesheet(final.row);
  }

  private async transitionSubmitted(
    tx: Db,
    id: string,
    data: {
      status: TimesheetStatus;
      decidedAt: Date;
      approverId: string | null;
      approverNote: string | null;
    },
  ) {
    try {
      return await tx.timesheet.update({
        where: { id, status: TimesheetStatus.SUBMITTED },
        data,
        include: { employee: { select: EMPLOYEE_SELECT } },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException('This timesheet has already been processed');
      }
      throw err;
    }
  }

  private async findForResponse(tenantId: string, id: string) {
    const row = await this.prisma.timesheet.findFirst({
      where: { id, tenantId },
      include: { employee: { select: EMPLOYEE_SELECT } },
    });
    if (!row) throw new NotFoundException('Timesheet not found');
    return serializeTimesheet(row);
  }

  /** Tell the owner the outcome. A failed notification never fails the decision. */
  private async notifyOwner(
    sheet: { tenantId: string; employeeId: string; weekStart: Date },
    approved: boolean,
    note?: string | null,
  ): Promise<void> {
    try {
      const userId = await findUserIdForEmployee(this.prisma, sheet.tenantId, sheet.employeeId);
      if (!userId) return;
      await this.notifications.create({
        tenantId: sheet.tenantId,
        userId,
        type: approved ? NotificationType.TIMESHEET_APPROVED : NotificationType.TIMESHEET_REJECTED,
        title: approved ? 'Timesheet approved' : 'Timesheet rejected',
        message: `Your timesheet for the week of ${fmtDate(sheet.weekStart)} was ${
          approved ? 'approved' : 'rejected'
        }.${note ? ` Note: ${note}` : ''}`,
        link: '/timesheets',
      });
    } catch {
      // Best effort: the decision has already been committed.
    }
  }

  // ----------------------------------------------------------------- reads

  /**
   * One timesheet with entries. Visible to its owner, HR, the employee's
   * direct manager, or an approver who can act on it now; anyone else gets 404.
   */
  async get(actor: AuthenticatedUser, id: string) {
    const tenantId = actor.tenantId;
    const sheet = await this.prisma.timesheet.findFirst({
      where: { id, tenantId },
      include: {
        employee: { select: EMPLOYEE_SELECT },
        entries: { include: ENTRY_RELATIONS, orderBy: { date: 'asc' } },
      },
    });
    if (!sheet || !(await this.canView(actor, sheet))) {
      throw new NotFoundException('Timesheet not found');
    }

    return {
      ...serializeTimesheet(sheet),
      entries: sheet.entries.map(serializeEntry),
    };
  }

  /** SUBMITTED timesheets the viewer can decide: all for HR/Super, else the engine's list. */
  async listPendingApprovals(actor: AuthenticatedUser) {
    const where: Prisma.TimesheetWhereInput = {
      tenantId: actor.tenantId,
      status: TimesheetStatus.SUBMITTED,
    };
    if (!isHr(actor)) {
      const ids = await this.workflow.listActionableEntityIds(
        actor,
        WorkflowEntityType.TIMESHEET,
      );
      where.id = { in: ids };
    }

    const rows = await this.prisma.timesheet.findMany({
      where,
      include: { employee: { select: EMPLOYEE_SELECT } },
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(serializeTimesheet);
  }

  /** Admin listing with filters, paginated (limit at most 100). */
  async listAll(actor: AuthenticatedUser, query: AllTimesheetsQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));

    const where: Prisma.TimesheetWhereInput = { tenantId: actor.tenantId };
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.weekStart = {
        ...(query.from ? { gte: parseDateOnly(query.from.slice(0, 10), 'from') } : {}),
        ...(query.to ? { lte: parseDateOnly(query.to.slice(0, 10), 'to') } : {}),
      };
    }
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.departmentId) where.employee = { departmentId: query.departmentId };

    const [rows, total] = await Promise.all([
      this.prisma.timesheet.findMany({
        where,
        include: { employee: { select: EMPLOYEE_SELECT } },
        orderBy: { weekStart: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.timesheet.count({ where }),
    ]);

    return {
      data: rows.map(serializeTimesheet),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  private async canView(
    actor: AuthenticatedUser,
    sheet: { id: string; employeeId: string; employee: { managerId: string | null } },
  ): Promise<boolean> {
    if (isHr(actor)) return true;
    // Guarded: an undefined employeeId must never match an owner or manager id.
    if (actor.employeeId) {
      if (sheet.employeeId === actor.employeeId) return true;
      if (sheet.employee.managerId === actor.employeeId) return true;
    }
    const actionable = await this.workflow.listActionableEntityIds(
      actor,
      WorkflowEntityType.TIMESHEET,
    );
    return actionable.includes(sheet.id);
  }

  // -------------------------------------------------------------- helpers

  /** AuthenticatedUser.employeeId is optional; an unguarded undefined matches every row. */
  private requireEmployee(actor: AuthenticatedUser): string {
    if (!actor.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    return actor.employeeId;
  }

  /** Shape and range checks that need no database. */
  private toCandidates(weekStart: Date, dto: SaveTimesheetEntriesDto): CandidateEntry[] {
    const last = weekEnd(weekStart);
    return dto.entries.map((raw) => {
      const date = new Date(`${raw.date}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime()) || isoDate(date) !== raw.date) {
        throw new BadRequestException(`Invalid entry date ${String(raw.date)}`);
      }
      if (date < weekStart || date > last) {
        throw new BadRequestException(`Entry date ${raw.date} is outside the week`);
      }
      if (typeof raw.hours !== 'number' || !Number.isFinite(raw.hours)) {
        throw new BadRequestException(`Hours for ${raw.date} must be a number`);
      }
      const hours = new Prisma.Decimal(raw.hours);
      if (hours.lte(0) || hours.gt(MAX_DAY_HOURS)) {
        throw new BadRequestException(`Hours for ${raw.date} must be above 0 and at most 24`);
      }
      if (hours.decimalPlaces() > 2) {
        throw new BadRequestException(`Hours for ${raw.date} allow at most 2 decimal places`);
      }
      return { date, projectId: raw.projectId, taskId: raw.taskId ?? null, hours };
    });
  }

  /**
   * Check every entry against projects, tasks and the caller's membership
   * windows with four queries. Shared by save and submit, so a membership
   * that ended after saving is caught on submit.
   */
  private async validateEntries(
    tx: Db,
    tenantId: string,
    employeeId: string,
    _weekStart: Date,
    entries: CandidateEntry[],
  ): Promise<Validation> {
    const errors: string[] = [];
    if (entries.length === 0) return { ok: true, billable: [] };

    const projectIds = [...new Set(entries.map((e) => e.projectId))];
    const taskIds = [...new Set(entries.map((e) => e.taskId).filter((t): t is string => !!t))];

    const [projects, tasks, openCounts, members] = await Promise.all([
      tx.project.findMany({
        where: { tenantId, id: { in: projectIds } },
        select: { id: true, code: true, name: true, status: true, billable: true },
      }),
      taskIds.length > 0
        ? tx.projectTask.findMany({
            where: { tenantId, id: { in: taskIds } },
            select: { id: true, projectId: true, status: true, billable: true },
          })
        : Promise.resolve([]),
      tx.projectTask.groupBy({
        by: ['projectId'],
        where: { tenantId, projectId: { in: projectIds }, status: 'OPEN' },
        _count: { _all: true },
      }),
      tx.projectMember.findMany({
        where: { tenantId, employeeId, projectId: { in: projectIds } },
        select: { projectId: true, startDate: true, endDate: true },
      }),
    ]);

    const projectById = new Map(projects.map((p) => [p.id, p]));
    const taskById = new Map(tasks.map((t) => [t.id, t]));
    const hasOpenTasks = new Set(
      openCounts.filter((c) => (c._count?._all ?? 0) > 0).map((c) => c.projectId),
    );
    const memberByProject = new Map(members.map((m) => [m.projectId, m]));

    const billable: boolean[] = [];
    const dayTotals = new Map<string, Prisma.Decimal>();
    const reported = new Set<string>();
    const report = (message: string) => {
      if (!reported.has(message)) {
        reported.add(message);
        errors.push(message);
      }
    };

    for (const e of entries) {
      const day = isoDate(e.date);
      const project = projectById.get(e.projectId);
      let flag = false;

      if (!project) {
        report(`Project not found for ${day}`);
      } else {
        flag = project.billable;
        if (project.status !== 'ACTIVE') {
          report(`Project ${project.code} is not active (${day})`);
        }
        const member = memberByProject.get(e.projectId);
        const covered =
          !!member &&
          member.startDate.getTime() <= e.date.getTime() &&
          (member.endDate === null || member.endDate.getTime() >= e.date.getTime());
        if (!covered) {
          report(`You are not a member of project ${project.code} on ${day}`);
        }

        if (e.taskId) {
          const task = taskById.get(e.taskId);
          if (!task || task.projectId !== e.projectId) {
            report(`The task for ${day} does not belong to project ${project.code}`);
          } else if (task.status !== 'OPEN') {
            report(`The task for ${day} on project ${project.code} is closed`);
          } else {
            flag = task.billable ?? project.billable;
          }
        } else if (hasOpenTasks.has(e.projectId)) {
          report(`Select a task for project ${project.code} (${day})`);
        }
      }
      billable.push(flag);

      dayTotals.set(day, (dayTotals.get(day) ?? new Prisma.Decimal(0)).plus(e.hours));
    }

    for (const [day, total] of dayTotals) {
      if (total.gt(MAX_DAY_HOURS)) {
        report(`Hours on ${day} total more than 24`);
      }
    }

    return errors.length > 0 ? { ok: false, errors } : { ok: true, billable };
  }
}

// ------------------------------------------------------------ serialisers

type SheetRow = {
  id: string;
  employeeId: string;
  weekStart: Date;
  status: TimesheetStatus;
  totalHours: Prisma.Decimal | number;
  submittedAt?: Date | null;
  decidedAt?: Date | null;
  approverNote?: string | null;
  employee?: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
};

type EntryRow = {
  id: string;
  date: Date;
  projectId: string;
  taskId: string | null;
  hours: Prisma.Decimal | number;
  billable: boolean;
  note: string | null;
  project?: { id: string; code: string; name: string } | null;
  task?: { id: string; name: string } | null;
};

export function serializeEntry(e: EntryRow) {
  return {
    id: e.id,
    date: isoDate(e.date),
    projectId: e.projectId,
    taskId: e.taskId,
    hours: toHours(e.hours),
    billable: e.billable,
    note: e.note,
    ...(e.project ? { project: e.project } : {}),
    ...(e.task !== undefined ? { task: e.task } : {}),
  };
}

export function serializeTimesheet(t: SheetRow) {
  return {
    id: t.id,
    employeeId: t.employeeId,
    weekStart: isoDate(t.weekStart),
    status: t.status,
    totalHours: toHours(t.totalHours),
    submittedAt: t.submittedAt ? t.submittedAt.toISOString() : null,
    decidedAt: t.decidedAt ? t.decidedAt.toISOString() : null,
    approverNote: t.approverNote ?? null,
    ...(t.employee
      ? {
          employee: {
            id: t.employee.id,
            name: `${t.employee.firstName} ${t.employee.lastName}`,
            code: t.employee.employeeCode,
          },
        }
      : {}),
  };
}
