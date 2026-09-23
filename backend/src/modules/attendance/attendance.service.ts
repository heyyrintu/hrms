import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
  PRISMA_WRITE_CONFLICT,
} from '../../common/utils/prisma-errors';
import { OtCalculationService } from './ot-calculation.service';
import {
  ClockInDto,
  ClockOutDto,
  ApproveOtDto,
  AttendanceQueryDto,
  AttendanceSummaryQueryDto,
  PayableHoursQueryDto,
  ManualAttendanceDto,
} from './dto/attendance.dto';
import {
  AttendancePolicy,
  AttendanceStatus,
  AttendanceSource,
  RegularizationStatus,
  Shift,
  UserRole,
  NotificationType,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { NotificationsService } from '../notifications/notifications.service';
import { AttendancePolicyService } from './policy/attendance-policy.service';
import {
  computeLateMark,
  LateMarkResult,
  zonedDateOnlyUtc,
  DEFAULT_ATTENDANCE_TIME_ZONE,
} from './rules/late-mark';
import {
  carriedSessionWindowMinutes,
  clockInBelongsToPreviousShift,
  previousDateOnly,
} from './rules/overnight-shift';
import { classifyWorkedDay } from './rules/day-classification';
import {
  coveringAssignmentWhere,
  effectiveShift,
  NEWEST_ASSIGNMENT_FIRST,
} from './rules/shift-lookup';

/** The working day a punch belongs to, and the shift that decided it. */
interface ShiftDay {
  date: Date;
  shift: Shift | null;
  /** True when the punch continues the overnight shift that began yesterday. */
  continuesPreviousShift: boolean;
}

/** The dashboard's view of the current working day. */
export interface TodayStatus {
  status: AttendanceStatus | 'NOT_CLOCKED_IN';
  clockedIn: boolean;
  clockInTime: Date | null;
  clockOutTime: Date | null;
  workedMinutes: number;
  otMinutesCalculated?: number;
  currentSessionStart?: Date | null;
  clockInLatitude?: number | null;
  clockInLongitude?: number | null;
  clockOutLatitude?: number | null;
  clockOutLongitude?: number | null;
}

/**
 * Statuses the worked-hours rule can have written, and so the only ones a new
 * session may restore over. LEAVE and HOLIDAY are decided elsewhere.
 */
const RESTORABLE_STATUSES: ReadonlySet<AttendanceStatus> = new Set<AttendanceStatus>([
  AttendanceStatus.PRESENT,
  AttendanceStatus.WFH,
  AttendanceStatus.HALF_DAY,
  AttendanceStatus.ABSENT,
]);

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private otCalculation: OtCalculationService,
    private notificationsService: NotificationsService,
    private policyService: AttendancePolicyService,
  ) {}

  /**
   * Clock in for an employee
   */
  async clockIn(tenantId: string, employeeId: string, dto: ClockInDto) {
    const now = new Date();

    // Check if employee exists
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId, status: 'ACTIVE' },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found or inactive');
    }

    // Validate GPS coordinates are finite numbers
    if (!Number.isFinite(dto.latitude) || !Number.isFinite(dto.longitude)) {
      throw new BadRequestException('Valid GPS coordinates are required to clock in.');
    }

    // Geofencing: validate employee is within office radius if configured
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { officeLatitude: true, officeLongitude: true, officeRadiusMeters: true },
    });

    if (
      tenant?.officeLatitude != null &&
      tenant?.officeLongitude != null &&
      tenant?.officeRadiusMeters != null
    ) {
      const distance = this.calculateDistanceMeters(
        dto.latitude,
        dto.longitude,
        tenant.officeLatitude,
        tenant.officeLongitude,
      );
      if (distance > tenant.officeRadiusMeters) {
        throw new BadRequestException(
          `You are ${Math.round(distance)}m from the office. Must be within ${tenant.officeRadiusMeters}m to clock in.`,
        );
      }
    }

    // `AttendanceRecord.date` is `@db.Date`, which Prisma writes from the UTC
    // date part. Deriving the day from the server's own zone would store the
    // wrong calendar day on any non-UTC box and the auto-absent sweep — which
    // reads the column on an IST/UTC-midnight basis — would then mark a
    // present employee ABSENT and cost them a day's pay under `absentIsLop`.
    // A night-shift punch after midnight belongs to the day the shift started.
    //
    // Resolve the day and score the punch before opening the transaction:
    // these are extra reads and a SERIALIZABLE transaction is the wrong place
    // to hold them.
    const {
      date: today,
      shift,
      continuesPreviousShift,
    } = await this.resolveShiftDay(tenantId, employeeId, now);
    const lateMark = await this.resolveLateMark(tenantId, shift, now, continuesPreviousShift);
    const shiftData = shift ? { shiftId: shift.id } : {};

    // The "is there an open session?" check and the session insert must be one
    // atomic unit, otherwise two near-simultaneous taps both see "no open session"
    // and both insert. A SERIALIZABLE transaction makes the loser fail with P2034.
    let attendanceId: string;
    try {
      attendanceId = await this.prisma.$transaction(
        async (tx) => {
          const attendance = await tx.attendanceRecord.findUnique({
            where: {
              tenantId_employeeId_date: { tenantId, employeeId, date: today },
            },
            include: { sessions: true },
          });

          if (attendance) {
            const openSession = attendance.sessions.find((s) => !s.outTime);
            if (openSession) {
              throw new BadRequestException('Already clocked in. Please clock out first.');
            }

            await tx.attendanceSession.create({
              data: { tenantId, attendanceId: attendance.id, inTime: now },
            });

            // Update clock in time if this is the first session of the day
            if (!attendance.clockInTime) {
              await tx.attendanceRecord.update({
                where: { id: attendance.id },
                data: {
                  clockInTime: now,
                  status: 'PRESENT',
                  source: dto.source || 'WEB',
                  remarks: dto.remarks,
                  clockInLatitude: dto.latitude,
                  clockInLongitude: dto.longitude,
                  isLate: lateMark.isLate,
                  lateByMinutes: lateMark.isLate ? lateMark.lateByMinutes : null,
                  // A row the absent sweep wrote (e.g. a night shift that
                  // started after the 23:30 sweep) is a real day now.
                  autoMarked: false,
                  ...shiftData,
                },
              });
            } else if (
              attendance.preClassificationStatus &&
              RESTORABLE_STATUSES.has(attendance.status)
            ) {
              // An earlier clock-out of this day (a lunch break, say) let the
              // worked-hours rule downgrade it. The day is not over, so put
              // back what the rule replaced; the next clock-out re-scores the
              // whole day. Without this the day reads ABSENT while clocked in
              // and stays so if the final clock-out is forgotten.
              await tx.attendanceRecord.update({
                where: { id: attendance.id },
                data: {
                  status: attendance.preClassificationStatus,
                  preClassificationStatus: null,
                },
              });
            }
            return attendance.id;
          }

          const created = await tx.attendanceRecord.create({
            data: {
              tenantId,
              employeeId,
              date: today,
              clockInTime: now,
              status: 'PRESENT',
              source: dto.source || 'WEB',
              remarks: dto.remarks,
              clockInLatitude: dto.latitude,
              clockInLongitude: dto.longitude,
              isLate: lateMark.isLate,
              lateByMinutes: lateMark.isLate ? lateMark.lateByMinutes : null,
              ...shiftData,
              standardWorkMinutes: 480, // 8 hours default
              sessions: { create: { tenantId, inTime: now } },
            },
            include: { sessions: true },
          });
          return created.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      // P2034: serializable write conflict. P2002: the loser of a create race on
      // the (tenantId, employeeId, date) unique key. Both mean another clock-in
      // for this employee and day won; neither is a server fault.
      if (
        isPrismaError(err, PRISMA_WRITE_CONFLICT) ||
        isPrismaError(err, PRISMA_UNIQUE_VIOLATION)
      ) {
        throw new ConflictException('Clock-in already in progress. Please try again.');
      }
      throw err;
    }

    return this.getAttendanceById(tenantId, attendanceId);
  }

  /**
   * Clock out for an employee
   */
  async clockOut(tenantId: string, employeeId: string, dto: ClockOutDto) {
    const now = new Date();
    // A clock-out closes whichever session is open, on the row its clock-in
    // wrote. Re-deriving the day from the shift here would disagree with the
    // clock-in whenever the shift changed between the two punches.
    const found = await this.findOpenAttendance(tenantId, employeeId, now);

    if (!found.attendance) {
      throw new BadRequestException('No clock-in record found for today');
    }

    const { attendance, openSession } = found;
    if (!openSession) {
      throw new BadRequestException('No open session found. Please clock in first.');
    }

    // Instants, not wall-clock times, so a session that crosses midnight
    // counts correctly.
    const sessionMinutes = Math.floor(
      (now.getTime() - openSession.inTime.getTime()) / (1000 * 60),
    );

    // Close the session
    await this.prisma.attendanceSession.update({
      where: { id: openSession.id },
      data: {
        outTime: now,
        sessionMinutes,
      },
    });

    // Get employee for OT calculation
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    // Get OT rule
    const otRule = employee
      ? await this.otCalculation.getOtRule(tenantId, employee.employmentType)
      : null;

    // Calculate total worked minutes from all sessions
    const allSessions = await this.prisma.attendanceSession.findMany({
      where: { attendanceId: attendance.id },
    });

    const totalWorkedMinutes = allSessions.reduce((sum, s) => {
      if (s.id === openSession.id) {
        return sum + sessionMinutes;
      }
      return sum + s.sessionMinutes;
    }, 0);

    // Subtract breaks
    const breakMinutes = dto.breakMinutes || attendance.breakMinutes || 0;
    const netWorkedMinutes = Math.max(0, totalWorkedMinutes - breakMinutes);

    // Calculate OT
    const otMinutesCalculated = this.otCalculation.calculateOtMinutes(
      netWorkedMinutes,
      attendance.standardWorkMinutes,
      otRule,
    );

    // The day's status is finalised here: first what the hours earned, then
    // the late-mark penalty on top of it.
    const policy = await this.policyService.getOrCreate(tenantId);
    const earnedStatus = await this.resolveWorkedDayStatus(
      tenantId,
      employeeId,
      attendance,
      netWorkedMinutes,
      policy,
    );
    const baseStatus = earnedStatus ?? attendance.status;
    const penaltyStatus = await this.resolveLateMarkPenalty(
      tenantId,
      employeeId,
      { ...attendance, status: baseStatus },
      policy,
    );
    const finalStatus = penaltyStatus ?? baseStatus;

    // Update attendance record
    await this.prisma.attendanceRecord.update({
      where: { id: attendance.id },
      data: {
        clockOutTime: now,
        breakMinutes,
        workedMinutes: netWorkedMinutes,
        otMinutesCalculated,
        remarks: dto.remarks || attendance.remarks,
        clockOutLatitude: dto.latitude ?? null,
        clockOutLongitude: dto.longitude ?? null,
        ...(finalStatus !== attendance.status ? { status: finalStatus } : {}),
        // Remember what the worked-hours rule replaced, so a further session
        // today can restore it (PRESENT, or WFH on a work-from-home day).
        ...(earnedStatus !== null
          ? { preClassificationStatus: attendance.preClassificationStatus ?? attendance.status }
          : {}),
      },
    });

    return this.getAttendanceById(tenantId, attendance.id);
  }

  /**
   * The working day a clock-in at `at` belongs to. Normally the IST calendar
   * day; the overnight shift that started yesterday keeps a punch only while
   * it is still plausibly that shift (see `clockInBelongsToPreviousShift`),
   * so an expired night assignment cannot swallow the next morning's day
   * shift.
   */
  private async resolveShiftDay(
    tenantId: string,
    employeeId: string,
    at: Date,
  ): Promise<ShiftDay> {
    const calendarDay = zonedDateOnlyUtc(at, DEFAULT_ATTENDANCE_TIME_ZONE);
    const yesterday = previousDateOnly(calendarDay);

    const [yesterdayShift, todayShift] = await Promise.all([
      this.findShiftOn(tenantId, employeeId, yesterday),
      this.findShiftOn(tenantId, employeeId, calendarDay),
    ]);

    if (
      clockInBelongsToPreviousShift(at, yesterdayShift, todayShift, DEFAULT_ATTENDANCE_TIME_ZONE)
    ) {
      return { date: yesterday, shift: yesterdayShift, continuesPreviousShift: true };
    }

    return { date: calendarDay, shift: todayShift, continuesPreviousShift: false };
  }

  /** The shift an employee is on for a given day, by the shared lookup rule. */
  private async findShiftOn(
    tenantId: string,
    employeeId: string,
    date: Date,
  ): Promise<Shift | null> {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: { ...coveringAssignmentWhere(tenantId, date), employeeId },
      orderBy: NEWEST_ASSIGNMENT_FIRST,
      include: { shift: true },
    });

    return effectiveShift(assignment);
  }

  /**
   * The record holding the session to close: today's open session; failing
   * that, yesterday's, when it is recent enough to be a shift still being
   * finished (a night shift, or a day shift worked past midnight; see
   * `carriedSessionWindowMinutes`).
   *
   * Yesterday is only considered when today has no clocked sessions. A today
   * row with closed sessions means the clock-out is a duplicate, and closing
   * a forgotten session from yesterday would book it as a 17-hour day. A
   * today row with no sessions (a LEAVE row, say) does not block it.
   */
  private async findOpenAttendance(tenantId: string, employeeId: string, now: Date) {
    const today = zonedDateOnlyUtc(now, DEFAULT_ATTENDANCE_TIME_ZONE);
    const load = (day: Date) =>
      this.prisma.attendanceRecord.findUnique({
        where: { tenantId_employeeId_date: { tenantId, employeeId, date: day } },
        include: { sessions: true, shift: true },
      });

    const attendance = await load(today);
    const openSession = attendance?.sessions.find((s) => !s.outTime);
    if (openSession) return { attendance, openSession };
    if (attendance && attendance.sessions.length > 0) {
      return { attendance, openSession: undefined };
    }

    const previous = await load(previousDateOnly(today));
    const windowMs = carriedSessionWindowMinutes(previous?.shift) * 60 * 1000;
    const carried = previous?.sessions.find(
      (s) => !s.outTime && now.getTime() - s.inTime.getTime() <= windowMs,
    );
    if (previous && carried) return { attendance: previous, openSession: carried };

    return { attendance, openSession: undefined };
  }

  /**
   * Score a clock-in against the employee's shift for that day, falling back to
   * the tenant policy's default shift when nobody has been given a shift.
   */
  private async resolveLateMark(
    tenantId: string,
    shift: Shift | null,
    clockInAt: Date,
    continuesPreviousShift: boolean,
  ): Promise<LateMarkResult> {
    if (shift) {
      // The end time is what lets a punch be scored against yesterday's
      // start. Pass it only when the punch was actually filed under
      // yesterday; a punch filed under today is on its shift's start day.
      return computeLateMark(
        clockInAt,
        shift.startTime,
        shift.graceMinutes,
        DEFAULT_ATTENDANCE_TIME_ZONE,
        continuesPreviousShift ? shift.endTime : null,
      );
    }

    const policy = await this.policyService.getOrCreate(tenantId);
    return computeLateMark(
      clockInAt,
      policy.defaultShiftStart,
      policy.defaultGraceMinutes,
    );
  }

  /**
   * What the day's net worked minutes earn under the tenant's half-day and
   * full-day thresholds, or null to keep the current status. A day an
   * approved regularization settled keeps whatever its approver decided.
   */
  private async resolveWorkedDayStatus(
    tenantId: string,
    employeeId: string,
    attendance: { date: Date; status: AttendanceStatus },
    netWorkedMinutes: number,
    policy: AttendancePolicy,
  ): Promise<AttendanceStatus | null> {
    const earned = classifyWorkedDay(netWorkedMinutes, attendance.status, policy);
    if (earned === null || earned === attendance.status) return null;

    const regularized = await this.prisma.attendanceRegularization.findFirst({
      where: {
        tenantId,
        employeeId,
        date: attendance.date,
        status: RegularizationStatus.APPROVED,
      },
      select: { id: true },
    });

    return regularized ? null : earned;
  }

  /**
   * Every Nth late mark in the calendar month costs half a day, where N is the
   * tenant's `lateMarksPerHalfDay`. Returns the status to force, or null when
   * the day keeps whatever status it already has.
   *
   * The count is taken over the month up to and including this day, so a
   * regularisation that clears an earlier late mark shifts the penalty forward
   * rather than stranding it.
   */
  private async resolveLateMarkPenalty(
    tenantId: string,
    employeeId: string,
    attendance: { date: Date; isLate: boolean; status: AttendanceStatus },
    policy: AttendancePolicy,
  ): Promise<AttendanceStatus | null> {
    if (!attendance.isLate) return null;

    const threshold = policy.lateMarksPerHalfDay;
    if (!threshold || threshold < 1) return null;

    // Already a half day or worse (HALF_DAY, ABSENT, LEAVE); do not soften it.
    if (attendance.status !== AttendanceStatus.PRESENT &&
        attendance.status !== AttendanceStatus.WFH) {
      return null;
    }

    const day = new Date(attendance.date);
    const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));

    const lateCount = await this.prisma.attendanceRecord.count({
      where: {
        tenantId,
        employeeId,
        isLate: true,
        date: { gte: monthStart, lte: day },
      },
    });

    return lateCount > 0 && lateCount % threshold === 0
      ? AttendanceStatus.HALF_DAY
      : null;
  }

  /**
   * Get attendance by ID
   */
  async getAttendanceById(tenantId: string, id: string) {
    const attendance = await this.prisma.attendanceRecord.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
          },
        },
        sessions: {
          orderBy: { inTime: 'asc' },
        },
      },
    });

    if (!attendance) {
      throw new NotFoundException('Attendance record not found');
    }

    return attendance;
  }

  /**
   * Get my attendance (for logged-in employee)
   */
  async getMyAttendance(tenantId: string, employeeId: string, query: AttendanceQueryDto) {
    const { from, to } = query;

    return this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        employeeId,
        date: {
          gte: new Date(from),
          lte: new Date(to),
        },
      },
      include: {
        sessions: {
          orderBy: { inTime: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Get attendance for a specific employee (manager/admin view)
   */
  async getEmployeeAttendance(
    tenantId: string,
    employeeId: string,
    query: AttendanceQueryDto,
  ) {
    const { from, to, status } = query;

    return this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        employeeId,
        date: {
          gte: new Date(from),
          lte: new Date(to),
        },
        ...(status && { status }),
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
        sessions: {
          orderBy: { inTime: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Get attendance summary
   */
  async getAttendanceSummary(tenantId: string, query: AttendanceSummaryQueryDto) {
    const { from, to, employeeId, departmentId } = query;

    const whereClause: Record<string, unknown> = {
      tenantId,
      date: {
        gte: new Date(from),
        lte: new Date(to),
      },
    };

    if (employeeId) {
      whereClause.employeeId = employeeId;
    }

    if (departmentId) {
      whereClause.employee = {
        departmentId,
      };
    }

    const records = await this.prisma.attendanceRecord.findMany({
      where: whereClause,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            departmentId: true,
          },
        },
      },
    });

    // Aggregate by status
    const statusCounts = records.reduce(
      (acc, record) => {
        acc[record.status] = (acc[record.status] || 0) + 1;
        return acc;
      },
      {} as Record<AttendanceStatus, number>,
    );

    // Calculate totals
    const totalWorkedMinutes = records.reduce((sum, r) => sum + r.workedMinutes, 0);
    const totalOtCalculated = records.reduce((sum, r) => sum + r.otMinutesCalculated, 0);
    const totalOtApproved = records.reduce((sum, r) => sum + (r.otMinutesApproved || 0), 0);

    return {
      period: { from, to },
      totalRecords: records.length,
      statusCounts,
      totalWorkedMinutes,
      totalWorkedHours: Math.round((totalWorkedMinutes / 60) * 100) / 100,
      totalOtCalculated,
      totalOtApproved,
      averageWorkedMinutesPerDay:
        records.length > 0 ? Math.round(totalWorkedMinutes / records.length) : 0,
    };
  }

  /**
   * Get pending OT approvals
   * - Managers see their direct reports only
   * - HR_ADMIN and SUPER_ADMIN see all
   */
  async getPendingOtApprovals(user: AuthenticatedUser) {
    const whereClause: any = {
      tenantId: user.tenantId,
      otMinutesCalculated: { gt: 0 },
      otMinutesApproved: null,
      clockOutTime: { not: null }, // Only completed attendance records
    };

    // Managers can only see their direct reports
    if (user.role === UserRole.MANAGER && user.employeeId) {
      whereClause.employee = {
        managerId: user.employeeId,
      };
    }

    return this.prisma.attendanceRecord.findMany({
      where: whereClause,
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
        sessions: {
          orderBy: { inTime: 'asc' },
        },
      },
      orderBy: [
        { date: 'desc' },
        { clockInTime: 'desc' },
      ],
    });
  }

  /**
   * Approve OT for an attendance record
   */
  async approveOt(tenantId: string, id: string, dto: ApproveOtDto) {
    const attendance = await this.getAttendanceById(tenantId, id);

    // Validate approved OT doesn't exceed calculated OT
    if (dto.otMinutesApproved > attendance.otMinutesCalculated) {
      throw new BadRequestException(
        `Approved OT (${dto.otMinutesApproved}) cannot exceed calculated OT (${attendance.otMinutesCalculated})`,
      );
    }

    const updated = await this.prisma.attendanceRecord.update({
      where: { id },
      data: {
        otMinutesApproved: dto.otMinutesApproved,
        remarks: dto.remarks || attendance.remarks,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
        sessions: true,
      },
    });

    // Notify the employee
    const hours = Math.floor(dto.otMinutesApproved / 60);
    const mins = dto.otMinutesApproved % 60;
    const otDisplay = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    this.notificationsService.notifyEmployee(
      tenantId,
      attendance.employeeId,
      NotificationType.OT_APPROVED,
      'OT Approved',
      `Your overtime of ${otDisplay} for ${new Date(attendance.date).toLocaleDateString()} has been approved.`,
      '/attendance',
    ).catch(() => {}); // Fire and forget

    return updated;
  }

  /**
   * Get payable hours for an employee
   */
  async getPayableHours(
    tenantId: string,
    employeeId: string,
    query: PayableHoursQueryDto,
  ) {
    const { from, to } = query;

    // Get employee details
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Get attendance records
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        employeeId,
        date: {
          gte: new Date(from),
          lte: new Date(to),
        },
      },
    });

    const totalWorkedMinutes = records.reduce((sum, r) => sum + r.workedMinutes, 0);
    const totalOtCalculated = records.reduce((sum, r) => sum + r.otMinutesCalculated, 0);
    const totalOtApproved = records.reduce((sum, r) => sum + (r.otMinutesApproved || 0), 0);

    const result: Record<string, unknown> = {
      employeeId,
      employeeCode: employee.employeeCode,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employmentType: employee.employmentType,
      payType: employee.payType,
      period: { from, to },
      totalWorkedMinutes,
      totalWorkedHours: Math.round((totalWorkedMinutes / 60) * 100) / 100,
      totalOtMinutesCalculated: totalOtCalculated,
      totalOtMinutesApproved: totalOtApproved,
      totalOtHoursApproved: Math.round((totalOtApproved / 60) * 100) / 100,
      daysWorked: records.filter((r) => r.status === 'PRESENT').length,
    };

    // For hourly employees, calculate estimated pay
    if (employee.payType === 'HOURLY' && employee.hourlyRate) {
      const hourlyRate = Number(employee.hourlyRate);
      const otMultiplier = Number(employee.otMultiplier) || 1.5;
      
      const regularHours = totalWorkedMinutes / 60;
      const otHours = totalOtApproved / 60;
      
      const regularPay = regularHours * hourlyRate;
      const otPay = otHours * hourlyRate * otMultiplier;
      
      result.hourlyRate = hourlyRate;
      result.otMultiplier = otMultiplier;
      result.estimatedRegularPay = Math.round(regularPay * 100) / 100;
      result.estimatedOtPay = Math.round(otPay * 100) / 100;
      result.estimatedTotalPay = Math.round((regularPay + otPay) * 100) / 100;
    }

    return result;
  }

  /**
   * Create manual attendance entry
   */
  async createManualAttendance(tenantId: string, dto: ManualAttendanceDto) {
    // Same UTC-midnight basis as the clock-in path and the auto-absent sweep.
    const dateOnly = zonedDateOnlyUtc(
      new Date(dto.date),
      DEFAULT_ATTENDANCE_TIME_ZONE,
    );

    // Check if employee exists
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Check if attendance already exists
    const existing = await this.prisma.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId: dto.employeeId,
          date: dateOnly,
        },
      },
    });

    if (existing) {
      throw new BadRequestException('Attendance record already exists for this date');
    }

    // Calculate worked minutes if clock times provided
    let workedMinutes = 0;
    let otMinutesCalculated = 0;

    if (dto.clockInTime && dto.clockOutTime) {
      const clockIn = new Date(dto.clockInTime);
      const clockOut = new Date(dto.clockOutTime);
      const breakMinutes = dto.breakMinutes || 0;

      workedMinutes = this.otCalculation.calculateWorkedMinutes(
        clockIn,
        clockOut,
        breakMinutes,
      );

      const otRule = await this.otCalculation.getOtRule(tenantId, employee.employmentType);
      otMinutesCalculated = this.otCalculation.calculateOtMinutes(
        workedMinutes,
        480, // default standard work minutes
        otRule,
      );
    }

    return this.prisma.attendanceRecord.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        date: dateOnly,
        clockInTime: dto.clockInTime ? new Date(dto.clockInTime) : null,
        clockOutTime: dto.clockOutTime ? new Date(dto.clockOutTime) : null,
        breakMinutes: dto.breakMinutes || 0,
        workedMinutes,
        otMinutesCalculated,
        status: dto.status || 'PRESENT',
        source: 'API',
        remarks: dto.remarks,
        standardWorkMinutes: 480,
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
          },
        },
      },
    });
  }

  /**
   * Haversine formula — returns great-circle distance in metres between two lat/lon points.
   */
  private calculateDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000; // Earth radius in metres
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Get today's attendance status for dashboard
   */
  async getTodayStatus(tenantId: string, employeeId: string): Promise<TodayStatus> {
    const now = new Date();

    // An open session is shown wherever it lives, exactly as clock-out would
    // find it, so a night-shift employee still on shift at 02:00 (or in
    // overtime at 08:30) sees the shift they are in.
    const open = await this.findOpenAttendance(tenantId, employeeId, now);
    if (open.attendance && open.openSession) {
      return this.toTodayStatus(open.attendance, open.openSession);
    }

    // Otherwise "today" is the working day a clock-in now would open.
    const { date: dateOnly } = await this.resolveShiftDay(tenantId, employeeId, now);

    const attendance = await this.prisma.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: dateOnly,
        },
      },
      include: {
        sessions: {
          orderBy: { inTime: 'desc' },
          take: 1,
        },
      },
    });

    if (!attendance) {
      return {
        status: 'NOT_CLOCKED_IN',
        clockedIn: false,
        clockInTime: null,
        clockOutTime: null,
        workedMinutes: 0,
      };
    }

    const lastSession = attendance.sessions[0];
    return this.toTodayStatus(
      attendance,
      lastSession && !lastSession.outTime ? lastSession : undefined,
    );
  }

  private toTodayStatus(
    attendance: {
      status: AttendanceStatus;
      clockInTime: Date | null;
      clockOutTime: Date | null;
      workedMinutes: number;
      otMinutesCalculated: number;
      clockInLatitude: number | null;
      clockInLongitude: number | null;
      clockOutLatitude: number | null;
      clockOutLongitude: number | null;
    },
    openSession: { inTime: Date } | undefined,
  ): TodayStatus {
    return {
      status: attendance.status,
      clockedIn: !!openSession,
      clockInTime: attendance.clockInTime,
      clockOutTime: attendance.clockOutTime,
      workedMinutes: attendance.workedMinutes,
      otMinutesCalculated: attendance.otMinutesCalculated,
      currentSessionStart: openSession ? openSession.inTime : null,
      clockInLatitude: attendance.clockInLatitude,
      clockInLongitude: attendance.clockInLongitude,
      clockOutLatitude: attendance.clockOutLatitude,
      clockOutLongitude: attendance.clockOutLongitude,
    };
  }
}
