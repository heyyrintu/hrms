import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { isOvernightShift } from '../attendance/rules/late-mark';
import { daysBetween, eachDate, parseDateOnly, patternDayIndex, toIsoDate } from './roster-dates';
import type { ResolvedShiftDay } from './roster.types';
import { ShiftResolverService } from './shift-resolver.service';

export const ROSTER_MANAGE_PERMISSION = 'attendance.roster.manage';

const MAX_APPLY_DAYS = 366;
const MAX_GRID_DAYS = 42;
const MAX_CELLS = 1000;
const UPDATE_CHUNK = 500;
const CREATE_CHUNK = 1000;

export interface RosterCellView {
  date: string;
  shiftId: string | null;
  shiftCode: string | null;
  shiftName: string | null;
  isOvernight: boolean;
  isOff: boolean;
  source: 'ROSTER' | 'ASSIGNMENT' | 'NONE';
}

export interface RosterRowView {
  employee: { id: string; name: string; code: string; department: string | null };
  cells: RosterCellView[];
}

export interface RosterGridView {
  days: string[];
  rows: RosterRowView[];
}

export interface ApplyRosterInput {
  patternId: string;
  employeeIds: string[];
  startDate: string;
  endDate: string;
  cycleOffset?: number;
  overwriteManual?: boolean;
}

export interface RosterCellInput {
  employeeId: string;
  date: string;
  shiftId?: string | null;
  isOff?: boolean;
  clear?: boolean;
}

type EmployeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  department: { name: string } | null;
};

const EMPLOYEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
  department: { select: { name: true } },
} as const;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function requireDate(value: string, label: string): Date {
  const date = parseDateOnly(value);
  if (!date) throw new BadRequestException(`${label} must be a valid YYYY-MM-DD date`);
  return date;
}

/** Parse and bound a `[from, to]` query range. */
function parseRange(from: string, to: string, maxDays: number): { from: Date; to: Date } {
  const start = requireDate(from, 'from');
  const end = requireDate(to, 'to');
  if (end < start) throw new BadRequestException('to must not be before from');
  if (daysBetween(start, end) + 1 > maxDays) {
    throw new BadRequestException(`The range can be at most ${maxDays} days`);
  }
  return { from: start, to: end };
}

function toCell(day: ResolvedShiftDay): RosterCellView {
  const shift = day.shift;
  return {
    date: toIsoDate(day.date),
    shiftId: shift?.id ?? null,
    shiftCode: shift?.code ?? null,
    shiftName: shift?.name ?? null,
    isOvernight: shift ? shift.isOvernight || isOvernightShift(shift.startTime, shift.endTime) : false,
    isOff: day.isOff,
    source: day.source,
  };
}

function toEmployeeView(e: EmployeeRow) {
  return {
    id: e.id,
    name: `${e.firstName} ${e.lastName}`.trim(),
    code: e.employeeCode,
    department: e.department?.name ?? null,
  };
}

/** The roster grid, cells and pattern application (Keka wave G, WS-R). */
@Injectable()
export class RosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftResolver: ShiftResolverService,
  ) {}

  /** Apply a rotation pattern to employees over a date range. */
  async apply(actor: AuthenticatedUser, input: ApplyRosterInput) {
    const start = requireDate(input.startDate, 'startDate');
    const end = requireDate(input.endDate, 'endDate');
    if (end < start) throw new BadRequestException('endDate must not be before startDate');
    if (daysBetween(start, end) + 1 > MAX_APPLY_DAYS) {
      throw new BadRequestException(`The range can be at most ${MAX_APPLY_DAYS} days`);
    }

    const { tenantId } = actor;
    const employeeIds = [...new Set(input.employeeIds)];
    const offset = input.cycleOffset ?? 0;

    const pattern = await this.prisma.shiftRotationPattern.findFirst({
      where: { id: input.patternId, tenantId, isActive: true },
      include: { days: { orderBy: { dayIndex: 'asc' } } },
    });
    if (!pattern) throw new NotFoundException('Rotation pattern not found');

    const employees = await this.prisma.employee.findMany({
      where: { tenantId, status: 'ACTIVE', id: { in: employeeIds } },
      select: { id: true },
    });
    if (employees.length !== employeeIds.length) {
      const known = new Set(employees.map((e) => e.id));
      const missing = employeeIds.filter((id) => !known.has(id));
      throw new BadRequestException(`Employees not found or not active: ${missing.join(', ')}`);
    }

    const shiftByIndex = new Map<number, string | null>(
      pattern.days.map((d) => [d.dayIndex, d.shiftId]),
    );
    const dates = eachDate(start, end);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.rosterEntry.findMany({
            where: {
              tenantId,
              employeeId: { in: employeeIds },
              date: { gte: start, lte: end },
            },
            select: { id: true, employeeId: true, date: true, source: true },
          });
          const existingByKey = new Map(
            existing.map((e) => [`${e.employeeId}|${toIsoDate(e.date)}`, e]),
          );

          const creates: Prisma.RosterEntryCreateManyInput[] = [];
          // Updates grouped by target so each group is one updateMany.
          const updates = new Map<string, { shiftId: string | null; ids: string[] }>();
          let skippedManual = 0;
          let updated = 0;

          for (const employeeId of employeeIds) {
            for (const date of dates) {
              const index = patternDayIndex(start, date, pattern.cycleLength, offset);
              const shiftId = shiftByIndex.get(index) ?? null;
              const current = existingByKey.get(`${employeeId}|${toIsoDate(date)}`);

              if (!current) {
                creates.push({
                  tenantId,
                  employeeId,
                  date,
                  shiftId,
                  isOff: shiftId === null,
                  source: 'PATTERN',
                  patternId: pattern.id,
                  createdById: actor.userId,
                });
                continue;
              }
              if (current.source === 'MANUAL' && !input.overwriteManual) {
                skippedManual += 1;
                continue;
              }
              const group = updates.get(shiftId ?? '') ?? { shiftId, ids: [] };
              group.ids.push(current.id);
              updates.set(shiftId ?? '', group);
              updated += 1;
            }
          }

          for (const group of updates.values()) {
            for (const ids of chunk(group.ids, UPDATE_CHUNK)) {
              await tx.rosterEntry.updateMany({
                where: { id: { in: ids } },
                data: {
                  shiftId: group.shiftId,
                  isOff: group.shiftId === null,
                  source: 'PATTERN',
                  patternId: pattern.id,
                },
              });
            }
          }

          let created = 0;
          for (const rows of chunk(creates, CREATE_CHUNK)) {
            const result = await tx.rosterEntry.createMany({ data: rows, skipDuplicates: false });
            created += result?.count ?? rows.length;
          }

          return { created, updated, skippedManual };
        },
        { timeout: 60_000 },
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('The roster changed while applying the pattern; try again');
      }
      throw error;
    }
  }

  /** The roster grid for a date range, scoped to the actor. */
  async getGrid(
    actor: AuthenticatedUser,
    query: { from: string; to: string; departmentId?: string; employeeIds?: string },
  ): Promise<RosterGridView> {
    const range = parseRange(query.from, query.to, MAX_GRID_DAYS);
    const { tenantId } = actor;

    const where: Prisma.EmployeeWhereInput = { tenantId, status: 'ACTIVE' };
    if (!this.seesEveryone(actor)) {
      // An undefined id in a Prisma where would match every row.
      if (!actor.employeeId) {
        throw new BadRequestException('No employee record linked to this user');
      }
      where.managerId = actor.employeeId;
    }
    if (query.departmentId) where.departmentId = query.departmentId;
    const requested = (query.employeeIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (requested.length > 0) where.id = { in: requested };

    const employees = (await this.prisma.employee.findMany({
      where,
      select: EMPLOYEE_SELECT,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    })) as EmployeeRow[];

    const days = eachDate(range.from, range.to).map(toIsoDate);
    if (employees.length === 0) return { days, rows: [] };

    const resolved = await this.shiftResolver.daysFor(
      tenantId,
      employees.map((e) => e.id),
      range.from,
      range.to,
    );
    const byEmployee = new Map<string, RosterCellView[]>();
    for (const day of resolved) {
      const list = byEmployee.get(day.employeeId) ?? [];
      list.push(toCell(day));
      byEmployee.set(day.employeeId, list);
    }

    return {
      days,
      rows: employees.map((e) => ({
        employee: toEmployeeView(e),
        cells: byEmployee.get(e.id) ?? [],
      })),
    };
  }

  /** Edit roster cells by hand. All or nothing. */
  async updateCells(actor: AuthenticatedUser, cells: RosterCellInput[]): Promise<RosterRowView[]> {
    if (!Array.isArray(cells) || cells.length === 0) {
      throw new BadRequestException('No cells to update');
    }
    if (cells.length > MAX_CELLS) {
      throw new BadRequestException(`At most ${MAX_CELLS} cells can be updated at once`);
    }

    const { tenantId } = actor;
    const parsed = cells.map((cell) => {
      const date = requireDate(cell.date, 'date');
      const hasShift = typeof cell.shiftId === 'string' && cell.shiftId.length > 0;
      const isOff = cell.isOff === true;
      const clear = cell.clear === true;

      if (clear) {
        if (hasShift || isOff) {
          throw new BadRequestException('A cell to clear cannot also set a shift or OFF');
        }
      } else if (hasShift && isOff) {
        throw new BadRequestException('A cell is either a shift or OFF, not both');
      } else if (!hasShift && !isOff) {
        throw new BadRequestException('Each cell needs a shiftId, isOff: true, or clear: true');
      }

      return {
        employeeId: cell.employeeId,
        date,
        shiftId: hasShift ? (cell.shiftId as string) : null,
        isOff,
        clear,
      };
    });

    const employeeIds = [...new Set(parsed.map((c) => c.employeeId))];
    const shiftIds = [...new Set(parsed.filter((c) => c.shiftId).map((c) => c.shiftId as string))];

    const [employees, shifts] = await Promise.all([
      this.prisma.employee.findMany({
        where: { tenantId, id: { in: employeeIds } },
        select: EMPLOYEE_SELECT,
      }) as Promise<EmployeeRow[]>,
      shiftIds.length > 0
        ? this.prisma.shift.findMany({
            where: { tenantId, id: { in: shiftIds }, isActive: true },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
    ]);
    if (employees.length !== employeeIds.length) {
      const known = new Set(employees.map((e) => e.id));
      throw new BadRequestException(
        `Unknown employee: ${employeeIds.filter((id) => !known.has(id)).join(', ')}`,
      );
    }
    if (shifts.length !== shiftIds.length) {
      const known = new Set(shifts.map((s) => s.id));
      throw new BadRequestException(
        `Unknown or inactive shift: ${shiftIds.filter((id) => !known.has(id)).join(', ')}`,
      );
    }

    await this.prisma.$transaction(
      async (tx) => {
        for (const cell of parsed) {
          if (cell.clear) {
            await tx.rosterEntry.deleteMany({
              where: { tenantId, employeeId: cell.employeeId, date: cell.date },
            });
            continue;
          }
          const values = { shiftId: cell.shiftId, isOff: cell.isOff };
          await tx.rosterEntry.upsert({
            where: {
              tenantId_employeeId_date: {
                tenantId,
                employeeId: cell.employeeId,
                date: cell.date,
              },
            },
            create: {
              tenantId,
              employeeId: cell.employeeId,
              date: cell.date,
              ...values,
              source: 'MANUAL',
              patternId: null,
              createdById: actor.userId,
            },
            update: { ...values, source: 'MANUAL', patternId: null },
          });
        }
      },
      { timeout: 60_000 },
    );

    // Report what each touched cell now resolves to (a cleared cell shows its fallback).
    const times = parsed.map((c) => c.date.getTime());
    const resolved = await this.shiftResolver.daysFor(
      tenantId,
      employeeIds,
      new Date(Math.min(...times)),
      new Date(Math.max(...times)),
    );
    const touched = new Set(parsed.map((c) => `${c.employeeId}|${toIsoDate(c.date)}`));
    const byEmployee = new Map<string, RosterCellView[]>();
    for (const day of resolved) {
      if (!touched.has(`${day.employeeId}|${toIsoDate(day.date)}`)) continue;
      const list = byEmployee.get(day.employeeId) ?? [];
      list.push(toCell(day));
      byEmployee.set(day.employeeId, list);
    }

    return employees.map((e) => ({
      employee: toEmployeeView(e),
      cells: byEmployee.get(e.id) ?? [],
    }));
  }

  /** The caller's own shifts for a date range. */
  async getMine(
    actor: AuthenticatedUser,
    query: { from: string; to: string },
  ): Promise<RosterCellView[]> {
    if (!actor.employeeId) {
      throw new BadRequestException('No employee record linked to this user');
    }
    const range = parseRange(query.from, query.to, MAX_GRID_DAYS);

    const days = await this.shiftResolver.daysFor(
      actor.tenantId,
      [actor.employeeId],
      range.from,
      range.to,
    );
    return days.map(toCell);
  }

  /** HR, Super Admin and holders of the roster permission see every employee. */
  private seesEveryone(actor: AuthenticatedUser): boolean {
    return (
      actor.role === UserRole.SUPER_ADMIN ||
      actor.role === UserRole.HR_ADMIN ||
      (actor.permissions ?? []).includes(ROSTER_MANAGE_PERMISSION)
    );
  }
}
