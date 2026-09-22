import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** What one day's sweep did for one tenant. */
export interface AutoAbsentResult {
  /** Rows created. */
  marked: number;
  /** Employees who were eligible but already accounted for that day. */
  skipped: number;
}

/** What the nightly cron did across every tenant that opted in. */
export interface AutoAbsentRunResult extends AutoAbsentResult {
  tenants: number;
  failed: number;
}

const ABSENT_STANDARD_WORK_MINUTES = 480;

/**
 * Sweeps a calendar day and records ABSENT for everyone who left no trace.
 *
 * "Left no trace" is deliberately conservative: a weekend, a tenant holiday, an
 * approved leave, an approved comp-off, or any existing attendance row all mean
 * the day is already explained, and an employee who had not joined yet is not
 * eligible at all. Only what is left over becomes an absence, because a false
 * ABSENT costs the employee a day's pay once `absentIsLop` is on.
 */
@Injectable()
export class AutoAbsentService {
  private readonly logger = new Logger(AutoAbsentService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Sweep one day for one tenant. Safe to re-run: the unique key on
   * (tenantId, employeeId, date) plus `skipDuplicates` means a second pass
   * writes nothing.
   *
   * The tenant's `autoMarkAbsent` flag is NOT consulted here — that gate lives
   * in `runForAllTenants`, so HR can still sweep a past day by hand from
   * `POST /attendance/mark-absent` on a tenant that leaves the cron off.
   */
  async markAbsentForDate(tenantId: string, date: Date): Promise<AutoAbsentResult> {
    const day = toDateOnlyUtc(date);

    // Saturday and Sunday are not working days anywhere this product ships.
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) return { marked: 0, skipped: 0 };

    const holiday = await this.prisma.holiday.findFirst({
      where: { tenantId, date: day, isActive: true },
      select: { id: true },
    });
    if (holiday) return { marked: 0, skipped: 0 };

    const employees = await this.prisma.employee.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        // End of the day, so someone who joined that morning still counts.
        joinDate: { lte: endOfDateOnlyUtc(day) },
        // Somebody who has already left must never be marked absent. `status`
        // alone is not enough: a record can sit at ACTIVE with an exit date
        // set until the separation is finalised. `gt` rather than `gte` keeps
        // the leaver's own exit day out of the sweep, because a false ABSENT
        // costs a day's pay and a missing one costs nothing.
        OR: [{ exitDate: null }, { exitDate: { gt: day } }],
      },
      select: { id: true },
    });
    if (employees.length === 0) return { marked: 0, skipped: 0 };

    const [existing, leaves, compOffs] = await Promise.all([
      this.prisma.attendanceRecord.findMany({
        where: { tenantId, date: day },
        select: { employeeId: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          tenantId,
          status: 'APPROVED',
          startDate: { lte: day },
          endDate: { gte: day },
        },
        select: { employeeId: true },
      }),
      // CompOffRequest stores only the worked date, so that is the day the
      // employee was demonstrably at work and must not be marked absent.
      this.prisma.compOffRequest.findMany({
        where: { tenantId, workedDate: day, status: { in: ['APPROVED', 'AVAILED'] } },
        select: { employeeId: true },
      }),
    ]);

    const accountedFor = new Set<string>([
      ...existing.map((r) => r.employeeId),
      ...leaves.map((l) => l.employeeId),
      ...compOffs.map((c) => c.employeeId),
    ]);

    const toCreate = employees
      .filter((e) => !accountedFor.has(e.id))
      .map((e) => ({
        tenantId,
        employeeId: e.id,
        date: day,
        status: 'ABSENT' as const,
        source: 'API' as const,
        autoMarked: true,
        standardWorkMinutes: ABSENT_STANDARD_WORK_MINUTES,
      }));

    const skipped = employees.length - toCreate.length;
    if (toCreate.length === 0) return { marked: 0, skipped };

    const result = await this.prisma.attendanceRecord.createMany({
      data: toCreate,
      skipDuplicates: true,
    });

    return { marked: result?.count ?? toCreate.length, skipped };
  }

  /**
   * Sweep the day for every tenant that turned `autoMarkAbsent` on. One
   * tenant's failure is logged and stepped over so the rest still run.
   */
  async runForAllTenants(date: Date): Promise<AutoAbsentRunResult> {
    const policies = await this.prisma.attendancePolicy.findMany({
      where: { autoMarkAbsent: true },
      select: { tenantId: true },
    });

    let marked = 0;
    let skipped = 0;
    let failed = 0;

    for (const { tenantId } of policies) {
      try {
        const result = await this.markAbsentForDate(tenantId, date);
        marked += result.marked;
        skipped += result.skipped;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `Auto-absent sweep failed for tenant ${tenantId}: ${(error as Error).message}`,
        );
      }
    }

    return { tenants: policies.length, marked, skipped, failed };
  }
}

/** Midnight UTC of the calendar day the given instant's UTC date-part names. */
function toDateOnlyUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The last millisecond of a date-only day. */
function endOfDateOnlyUtc(day: Date): Date {
  return new Date(day.getTime() + 24 * 60 * 60 * 1000 - 1);
}
