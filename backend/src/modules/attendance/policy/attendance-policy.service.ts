import { BadRequestException, Injectable } from '@nestjs/common';
import { AttendancePolicy, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../../../common/utils/prisma-errors';
import { validateIpRange } from '../rules/ip-allowlist';
import { UpdateAttendancePolicyDto } from '../dto/update-attendance-policy.dto';

/**
 * The tenant's attendance rulebook: what counts as late, whether missing days
 * are swept into ABSENT, and whether an ABSENT day costs pay.
 *
 * The defaults below mirror the schema defaults deliberately. Writing them out
 * means a freshly created row is the same object whether it came from Prisma's
 * defaults or from this code, so callers never have to cope with two shapes.
 */
export const ATTENDANCE_POLICY_DEFAULTS = {
  defaultShiftStart: '09:00',
  defaultGraceMinutes: 15,
  lateMarksPerHalfDay: null,
  autoMarkAbsent: false,
  absentIsLop: true,
  minHalfDayMinutes: 240,
  minFullDayMinutes: 480,
} as const;

@Injectable()
export class AttendancePolicyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Read the tenant's policy, creating it with defaults the first time anyone
   * asks. Two simultaneous first reads race on the `tenantId` unique key; the
   * loser re-reads rather than failing, because both callers want the same row.
   * Pass `tx` to keep the read (and any create/re-read) on the caller's
   * transaction connection instead of a separate one.
   */
  async getOrCreate(
    tenantId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<AttendancePolicy> {
    const db = tx ?? this.prisma;
    const existing = await db.attendancePolicy.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;

    try {
      return await db.attendancePolicy.create({
        data: { tenantId, ...ATTENDANCE_POLICY_DEFAULTS },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_UNIQUE_VIOLATION)) {
        const raced = await db.attendancePolicy.findUnique({
          where: { tenantId },
        });
        if (raced) return raced;
      }
      throw err;
    }
  }

  /**
   * Apply a partial update. Keys the caller did not send are left alone; an
   * explicit `lateMarksPerHalfDay: null` is honoured, since that is how the
   * half-day penalty is switched off.
   */
  async update(
    tenantId: string,
    dto: UpdateAttendancePolicyDto,
  ): Promise<AttendancePolicy> {
    const current = await this.getOrCreate(tenantId);

    // Checked against the stored value of whichever threshold was not sent.
    // 0 switches a threshold off, so the ordering only matters when both are on.
    const half = dto.minHalfDayMinutes ?? current.minHalfDayMinutes;
    const full = dto.minFullDayMinutes ?? current.minFullDayMinutes;
    if (half > 0 && full > 0 && half > full) {
      throw new BadRequestException(
        'minHalfDayMinutes cannot be greater than minFullDayMinutes',
      );
    }

    let ranges: string[] | undefined;
    if (dto.allowedIpRanges !== undefined) {
      ranges = [...new Set(dto.allowedIpRanges.map((r) => r.trim()))];
      for (const r of ranges) {
        const error = validateIpRange(r);
        if (error) throw new BadRequestException(error);
      }
    }
    const effectiveRanges = ranges ?? current.allowedIpRanges ?? [];
    const effectiveEnabled = dto.ipRestrictionEnabled ?? current.ipRestrictionEnabled ?? false;
    if (effectiveEnabled && effectiveRanges.length === 0) {
      throw new BadRequestException(
        'Add at least one allowed IP range before enabling IP restriction',
      );
    }

    const data: Prisma.AttendancePolicyUpdateInput = {};
    if (dto.defaultShiftStart !== undefined) data.defaultShiftStart = dto.defaultShiftStart;
    if (dto.defaultGraceMinutes !== undefined)
      data.defaultGraceMinutes = dto.defaultGraceMinutes;
    if (dto.lateMarksPerHalfDay !== undefined)
      data.lateMarksPerHalfDay = dto.lateMarksPerHalfDay;
    if (dto.autoMarkAbsent !== undefined) data.autoMarkAbsent = dto.autoMarkAbsent;
    if (dto.absentIsLop !== undefined) data.absentIsLop = dto.absentIsLop;
    if (dto.minHalfDayMinutes !== undefined) data.minHalfDayMinutes = dto.minHalfDayMinutes;
    if (dto.minFullDayMinutes !== undefined) data.minFullDayMinutes = dto.minFullDayMinutes;
    if (dto.ipRestrictionEnabled !== undefined)
      data.ipRestrictionEnabled = dto.ipRestrictionEnabled;
    if (ranges !== undefined) data.allowedIpRanges = ranges;
    if (dto.selfieRequired !== undefined) data.selfieRequired = dto.selfieRequired;

    return this.prisma.attendancePolicy.update({ where: { tenantId }, data });
  }
}
