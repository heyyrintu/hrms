import { Injectable } from '@nestjs/common';
import type { Shift } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  coveringAssignmentWhere,
  effectiveShift,
  NEWEST_ASSIGNMENT_FIRST,
  rosterDayResult,
} from '../attendance/rules/shift-lookup';
import type { ResolvedShiftDay } from './roster.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of the given instant's UTC calendar day. */
function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const key = (employeeId: string, date: Date) => `${employeeId}|${date.toISOString().slice(0, 10)}`;

/**
 * "Which shift is this employee on, on this day" (Keka wave G). The one rule:
 *
 * 1. A `RosterEntry` for the day wins: OFF, its shift, or (inactive shift) no
 *    shift, never falling back to an assignment.
 * 2. Otherwise the covering active `ShiftAssignment` (`rules/shift-lookup.ts`).
 * 3. Otherwise no shift.
 */
@Injectable()
export class ShiftResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async shiftOn(tenantId: string, employeeId: string, date: Date): Promise<Shift | null> {
    return (await this.dayOn(tenantId, employeeId, date)).shift;
  }

  async dayOn(tenantId: string, employeeId: string, date: Date): Promise<ResolvedShiftDay> {
    const entry = await this.prisma.rosterEntry.findUnique({
      where: { tenantId_employeeId_date: { tenantId, employeeId, date } },
      include: { shift: true },
    });
    if (entry) return rosterDayResult(employeeId, date, entry);

    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { ...coveringAssignmentWhere(tenantId, date), employeeId },
      orderBy: NEWEST_ASSIGNMENT_FIRST,
      include: { shift: true },
    });
    const shift = effectiveShift(assignment);
    return { employeeId, date, shift, isOff: false, source: shift ? 'ASSIGNMENT' : 'NONE' };
  }

  /**
   * One entry per employee per day in `[from, to]` (inclusive), employee by
   * employee, with at most two queries for the whole range.
   */
  async daysFor(
    tenantId: string,
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<ResolvedShiftDay[]> {
    const first = utcDay(from);
    const last = utcDay(to);
    if (employeeIds.length === 0 || first > last) return [];

    const [entries, assignments] = await Promise.all([
      this.prisma.rosterEntry.findMany({
        where: {
          tenantId,
          employeeId: { in: employeeIds },
          date: { gte: first, lte: last },
        },
        include: { shift: true },
      }),
      this.prisma.shiftAssignment.findMany({
        where: {
          tenantId,
          employeeId: { in: employeeIds },
          isActive: true,
          startDate: { lte: last },
          OR: [{ endDate: null }, { endDate: { gte: first } }],
        },
        orderBy: NEWEST_ASSIGNMENT_FIRST,
        include: { shift: true },
      }),
    ]);

    const rostered = new Map<string, (typeof entries)[number]>();
    for (const e of entries ?? []) rostered.set(key(e.employeeId, e.date), e);

    const byEmployee = new Map<string, typeof assignments>();
    for (const a of assignments ?? []) {
      const list = byEmployee.get(a.employeeId) ?? [];
      list.push(a);
      byEmployee.set(a.employeeId, list);
    }

    const result: ResolvedShiftDay[] = [];
    for (const employeeId of employeeIds) {
      const rows = byEmployee.get(employeeId) ?? [];
      for (let t = first.getTime(); t <= last.getTime(); t += DAY_MS) {
        const day = new Date(t);
        const entry = rostered.get(key(employeeId, day));
        if (entry) {
          result.push(rosterDayResult(employeeId, day, entry));
          continue;
        }
        // Rows are newest-start first, so the first covering row wins.
        const covering = rows.find(
          (a) => a.startDate <= day && (a.endDate === null || a.endDate >= day),
        );
        const shift = effectiveShift(covering);
        result.push({
          employeeId,
          date: day,
          shift,
          isOff: false,
          source: shift ? 'ASSIGNMENT' : 'NONE',
        });
      }
    }
    return result;
  }
}
