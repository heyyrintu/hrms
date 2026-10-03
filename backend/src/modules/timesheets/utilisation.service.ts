import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TimesheetStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ShiftResolverService } from '../roster/shift-resolver.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { capacityHours, pct } from './capacity';
import { isoDate, parseDateOnly, toHours } from './timesheet-week';
import { UtilisationGroupBy, UtilisationQueryDto } from './dto/utilisation.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 92;
const REPORTS_PERMISSION = 'projects.reports.view';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface EmployeeUtilisationRow {
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  capacityHours: number;
  loggedHours: number;
  billableHours: number;
  utilisationPct: number | null;
  billablePct: number | null;
}

export interface ProjectUtilisationRow {
  projectId: string;
  code: string;
  name: string;
  loggedHours: number;
  billableHours: number;
  billableSharePct: number | null;
  contributors: number;
}

export interface UtilisationReport {
  query: {
    from: string;
    to: string;
    groupBy: UtilisationGroupBy;
    departmentId?: string;
    projectId?: string;
    employeeId?: string;
    includeSubmitted?: boolean;
  };
  generatedAt: string;
  rows: EmployeeUtilisationRow[] | ProjectUtilisationRow[];
  totals:
    | Omit<EmployeeUtilisationRow, 'employeeId' | 'name' | 'code' | 'department'>
    | Omit<ProjectUtilisationRow, 'projectId' | 'code' | 'name'>;
}

interface Scope {
  /** Employee grouping: only the caller's direct reports. */
  directReportsOnly: boolean;
  /** Project grouping: only projects the caller manages. */
  managedProjectsOnly: boolean;
}

/** Utilisation against capacity (Keka wave G, WS-T). */
@Injectable()
export class UtilisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftResolver: ShiftResolverService,
  ) {}

  async build(actor: AuthenticatedUser, q: UtilisationQueryDto): Promise<UtilisationReport> {
    const from = parseDateOnly(q.from, 'from');
    const to = parseDateOnly(q.to, 'to');
    if (to < from) throw new BadRequestException('to must not be before from');
    if ((to.getTime() - from.getTime()) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`The range is limited to ${MAX_RANGE_DAYS} days`);
    }

    const scope = await this.resolveScope(actor, q.groupBy);
    const tenantId = actor.tenantId;

    if (q.projectId) {
      const project = await this.prisma.project.findFirst({
        where: {
          id: q.projectId,
          tenantId,
          ...(scope.managedProjectsOnly ? { managerEmployeeId: actor.employeeId } : {}),
        },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('Project not found');
    }

    const statuses: TimesheetStatus[] = q.includeSubmitted
      ? [TimesheetStatus.APPROVED, TimesheetStatus.SUBMITTED]
      : [TimesheetStatus.APPROVED];

    const query: UtilisationReport['query'] = {
      from: q.from,
      to: q.to,
      groupBy: q.groupBy,
      ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(q.employeeId ? { employeeId: q.employeeId } : {}),
      ...(q.includeSubmitted ? { includeSubmitted: true } : {}),
    };

    const body =
      q.groupBy === 'employee'
        ? await this.byEmployee(actor, q, scope, from, to, statuses)
        : await this.byProject(actor, q, scope, from, to, statuses);

    return { query, generatedAt: new Date().toISOString(), ...body };
  }

  async exportCsv(actor: AuthenticatedUser, q: UtilisationQueryDto): Promise<string> {
    const report = await this.build(actor, q);
    const lines: string[] = [];

    if (q.groupBy === 'employee') {
      lines.push(
        csvRow([
          'Employee Code',
          'Employee',
          'Department',
          'Capacity (h)',
          'Logged (h)',
          'Billable (h)',
          'Utilisation %',
          'Billable %',
        ]),
      );
      for (const r of report.rows as EmployeeUtilisationRow[]) {
        lines.push(
          csvRow([
            text(r.code),
            text(r.name),
            text(r.department),
            r.capacityHours,
            r.loggedHours,
            r.billableHours,
            r.utilisationPct,
            r.billablePct,
          ]),
        );
      }
    } else {
      lines.push(
        csvRow([
          'Project Code',
          'Project',
          'Logged (h)',
          'Billable (h)',
          'Billable share %',
          'Contributors',
        ]),
      );
      for (const r of report.rows as ProjectUtilisationRow[]) {
        lines.push(
          csvRow([
            text(r.code),
            text(r.name),
            r.loggedHours,
            r.billableHours,
            r.billableSharePct,
            r.contributors,
          ]),
        );
      }
    }
    return lines.join('\r\n');
  }

  // ------------------------------------------------------------------ scope

  private async resolveScope(actor: AuthenticatedUser, groupBy: UtilisationGroupBy): Promise<Scope> {
    const admin =
      actor.role === UserRole.HR_ADMIN ||
      actor.role === UserRole.SUPER_ADMIN ||
      (actor.permissions ?? []).includes(REPORTS_PERMISSION);
    if (admin) return { directReportsOnly: false, managedProjectsOnly: false };

    // A missing employeeId must never reach a where clause: it matches every row.
    if (!actor.employeeId) {
      throw new ForbiddenException('You do not have access to the utilisation report');
    }

    if (groupBy === 'employee') {
      if (actor.role !== UserRole.MANAGER) {
        throw new ForbiddenException('The employee report is available to managers and HR');
      }
      return { directReportsOnly: true, managedProjectsOnly: false };
    }

    if (actor.role !== UserRole.MANAGER) {
      const managed = await this.prisma.project.count({
        where: { tenantId: actor.tenantId, managerEmployeeId: actor.employeeId },
      });
      if (managed === 0) {
        throw new ForbiddenException('You do not have access to the utilisation report');
      }
    }
    return { directReportsOnly: false, managedProjectsOnly: true };
  }

  // -------------------------------------------------------- employee grouping

  private async byEmployee(
    actor: AuthenticatedUser,
    q: UtilisationQueryDto,
    scope: Scope,
    from: Date,
    to: Date,
    statuses: TimesheetStatus[],
  ): Promise<Pick<UtilisationReport, 'rows' | 'totals'>> {
    const tenantId = actor.tenantId;

    const employees = await this.prisma.employee.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        ...(scope.directReportsOnly ? { managerId: actor.employeeId } : {}),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.employeeId ? { id: q.employeeId } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        joinDate: true,
        exitDate: true,
        department: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    if (q.employeeId && employees.length === 0) {
      throw new NotFoundException('Employee not found');
    }
    if (employees.length === 0) {
      return { rows: [], totals: employeeTotals([]) };
    }
    const ids = employees.map((e) => e.id);

    const [entries, holidays, leaves, days] = await Promise.all([
      this.prisma.timesheetEntry.findMany({
        where: {
          tenantId,
          date: { gte: from, lte: to },
          ...(q.projectId ? { projectId: q.projectId } : {}),
          timesheet: { status: { in: statuses }, employeeId: { in: ids } },
        },
        select: {
          hours: true,
          billable: true,
          projectId: true,
          timesheet: { select: { employeeId: true } },
        },
      }),
      this.prisma.holiday.findMany({
        where: {
          tenantId,
          isActive: true,
          isOptional: false,
          date: { gte: from, lte: to },
        },
        select: { date: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          tenantId,
          status: 'APPROVED',
          employeeId: { in: ids },
          startDate: { lte: to },
          endDate: { gte: from },
        },
        select: { employeeId: true, startDate: true, endDate: true, isHalfDay: true },
      }),
      this.shiftResolver.daysFor(tenantId, ids, from, to),
    ]);

    const holidaySet = new Set(holidays.map((h) => isoDate(h.date)));

    const leaveByEmployee = new Map<string, Map<string, number>>();
    for (const leave of leaves) {
      const perDay = leaveByEmployee.get(leave.employeeId) ?? new Map<string, number>();
      const first = leave.startDate > from ? leave.startDate : from;
      const last = leave.endDate < to ? leave.endDate : to;
      for (let t = new Date(first); t <= last; t.setUTCDate(t.getUTCDate() + 1)) {
        const key = isoDate(t);
        perDay.set(key, Math.min(1, (perDay.get(key) ?? 0) + (leave.isHalfDay ? 0.5 : 1)));
      }
      leaveByEmployee.set(leave.employeeId, perDay);
    }

    const minutesByEmployee = new Map<string, Map<string, number>>();
    for (const day of days) {
      let minutes: number | null = null;
      if (day.isOff) minutes = 0;
      else if (day.shift) minutes = day.shift.standardWorkMinutes;
      if (minutes === null) continue;
      const perDay = minutesByEmployee.get(day.employeeId) ?? new Map<string, number>();
      perDay.set(isoDate(day.date), minutes);
      minutesByEmployee.set(day.employeeId, perDay);
    }

    const logged = new Map<string, { hours: number; billable: number }>();
    for (const e of entries) {
      const key = e.timesheet.employeeId;
      const acc = logged.get(key) ?? { hours: 0, billable: 0 };
      const h = toHours(e.hours);
      acc.hours += h;
      if (e.billable) acc.billable += h;
      logged.set(key, acc);
    }

    const rows: EmployeeUtilisationRow[] = employees.map((emp) => {
      const capacity = capacityHours({
        from,
        to,
        joinDate: emp.joinDate,
        exitDate: emp.exitDate,
        holidays: holidaySet,
        leaveDays: leaveByEmployee.get(emp.id) ?? new Map(),
        standardMinutesByDate: minutesByEmployee.get(emp.id) ?? new Map(),
      });
      const acc = logged.get(emp.id) ?? { hours: 0, billable: 0 };
      const loggedHours = round2(acc.hours);
      const billableHours = round2(acc.billable);
      return {
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        code: emp.employeeCode,
        department: emp.department?.name ?? null,
        capacityHours: capacity,
        loggedHours,
        billableHours,
        utilisationPct: pct(loggedHours, capacity),
        billablePct: pct(billableHours, capacity),
      };
    });

    return { rows, totals: employeeTotals(rows) };
  }

  // --------------------------------------------------------- project grouping

  private async byProject(
    actor: AuthenticatedUser,
    q: UtilisationQueryDto,
    scope: Scope,
    from: Date,
    to: Date,
    statuses: TimesheetStatus[],
  ): Promise<Pick<UtilisationReport, 'rows' | 'totals'>> {
    const tenantId = actor.tenantId;

    if (q.employeeId) {
      const employee = await this.prisma.employee.findFirst({
        where: { id: q.employeeId, tenantId },
        select: { id: true },
      });
      if (!employee) throw new NotFoundException('Employee not found');
    }

    const where: Prisma.TimesheetEntryWhereInput = {
      tenantId,
      date: { gte: from, lte: to },
      ...(q.projectId ? { projectId: q.projectId } : {}),
      ...(scope.managedProjectsOnly ? { project: { managerEmployeeId: actor.employeeId } } : {}),
      timesheet: {
        status: { in: statuses },
        ...(q.employeeId ? { employeeId: q.employeeId } : {}),
        ...(q.departmentId ? { employee: { departmentId: q.departmentId } } : {}),
      },
    };

    const entries = await this.prisma.timesheetEntry.findMany({
      where,
      select: {
        hours: true,
        billable: true,
        projectId: true,
        timesheet: { select: { employeeId: true } },
      },
    });

    const perProject = new Map<
      string,
      { hours: number; billable: number; people: Set<string> }
    >();
    for (const e of entries) {
      const acc = perProject.get(e.projectId) ?? { hours: 0, billable: 0, people: new Set() };
      const h = toHours(e.hours);
      acc.hours += h;
      if (e.billable) acc.billable += h;
      acc.people.add(e.timesheet.employeeId);
      perProject.set(e.projectId, acc);
    }
    if (perProject.size === 0) {
      return { rows: [], totals: projectTotals([]) };
    }

    const projects = await this.prisma.project.findMany({
      where: { tenantId, id: { in: [...perProject.keys()] } },
      select: { id: true, code: true, name: true },
    });

    const rows: ProjectUtilisationRow[] = projects
      .map((p) => {
        const acc = perProject.get(p.id)!;
        const loggedHours = round2(acc.hours);
        const billableHours = round2(acc.billable);
        return {
          projectId: p.id,
          code: p.code,
          name: p.name,
          loggedHours,
          billableHours,
          billableSharePct: pct(billableHours, loggedHours),
          contributors: acc.people.size,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));

    return { rows, totals: projectTotals(rows) };
  }
}

// ----------------------------------------------------------------- totals

function employeeTotals(rows: EmployeeUtilisationRow[]) {
  const capacity = round2(rows.reduce((s, r) => s + r.capacityHours, 0));
  const logged = round2(rows.reduce((s, r) => s + r.loggedHours, 0));
  const billable = round2(rows.reduce((s, r) => s + r.billableHours, 0));
  return {
    capacityHours: capacity,
    loggedHours: logged,
    billableHours: billable,
    utilisationPct: pct(logged, capacity),
    billablePct: pct(billable, capacity),
  };
}

function projectTotals(rows: ProjectUtilisationRow[]) {
  const logged = round2(rows.reduce((s, r) => s + r.loggedHours, 0));
  const billable = round2(rows.reduce((s, r) => s + r.billableHours, 0));
  return {
    loggedHours: logged,
    billableHours: billable,
    billableSharePct: pct(billable, logged),
    // The sum of the rows: someone on two projects counts once on each.
    contributors: rows.reduce((s, r) => s + r.contributors, 0),
  };
}

// -------------------------------------------------------------------- CSV

/** A text cell: tagged so a leading formula character is neutralised. */
class TextCell {
  constructor(readonly value: string) {}
}
const text = (v: string | null): TextCell | null => (v === null ? null : new TextCell(v));

function csvCell(cell: string | number | TextCell | null): string {
  if (cell === null || cell === undefined) return '';
  let value = cell instanceof TextCell ? cell.value : String(cell);
  // Spreadsheet formula injection: names and codes come from user input.
  if (cell instanceof TextCell && /^[=+\-@\t\r]/.test(value)) value = `'${value}`;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(cells: Array<string | number | TextCell | null>): string {
  return cells.map(csvCell).join(',');
}
