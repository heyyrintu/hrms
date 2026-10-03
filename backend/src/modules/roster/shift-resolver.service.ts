import { Injectable } from '@nestjs/common';
import type { Shift } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  coveringAssignmentWhere,
  effectiveShift,
  NEWEST_ASSIGNMENT_FIRST,
} from '../attendance/rules/shift-lookup';
import type { ResolvedShiftDay } from './roster.types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of the given instant's UTC calendar day. */
function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * "Which shift is this employee on, on this day" (Keka wave G).
 *
 * Scaffold: today's rule only (active `ShiftAssignment`s, via
 * `rules/shift-lookup.ts`), so behaviour is unchanged. WS-R adds roster
 * entries ahead of the assignment rule.
 */
@Injectable()
export class ShiftResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async shiftOn(tenantId: string, employeeId: string, date: Date): Promise<Shift | null> {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { ...coveringAssignmentWhere(tenantId, date), employeeId },
      orderBy: NEWEST_ASSIGNMENT_FIRST,
      include: { shift: true },
    });

    return effectiveShift(assignment);
  }

  async dayOn(tenantId: string, employeeId: string, date: Date): Promise<ResolvedShiftDay> {
    const shift = await this.shiftOn(tenantId, employeeId, date);
    return {
      employeeId,
      date,
      shift,
      isOff: false,
      source: shift ? 'ASSIGNMENT' : 'NONE',
    };
  }

  /**
   * One entry per employee per day in `[from, to]` (inclusive), with one
   * query for the whole range.
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

    const assignments = await this.prisma.shiftAssignment.findMany({
      where: {
        tenantId,
        employeeId: { in: employeeIds },
        isActive: true,
        startDate: { lte: last },
        OR: [{ endDate: null }, { endDate: { gte: first } }],
      },
      orderBy: NEWEST_ASSIGNMENT_FIRST,
      include: { shift: true },
    });

    const byEmployee = new Map<string, typeof assignments>();
    for (const a of assignments) {
      const list = byEmployee.get(a.employeeId) ?? [];
      list.push(a);
      byEmployee.set(a.employeeId, list);
    }

    const result: ResolvedShiftDay[] = [];
    for (const employeeId of employeeIds) {
      const rows = byEmployee.get(employeeId) ?? [];
      for (let t = first.getTime(); t <= last.getTime(); t += DAY_MS) {
        const day = new Date(t);
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
