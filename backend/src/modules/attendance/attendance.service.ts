import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
import { AttendanceStatus, AttendanceSource, UserRole, NotificationType } from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private otCalculation: OtCalculationService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Clock in for an employee
   */
  async clockIn(tenantId: string, employeeId: string, dto: ClockInDto) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

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

    // Check if already clocked in today
    let attendance = await this.prisma.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: today,
        },
      },
      include: { sessions: true },
    });

    if (attendance) {
      // Check if there's an open session
      const openSession = attendance.sessions.find((s) => !s.outTime);
      if (openSession) {
        throw new BadRequestException('Already clocked in. Please clock out first.');
      }

      // Create a new session for the existing attendance record
      await this.prisma.attendanceSession.create({
        data: {
          attendanceId: attendance.id,
          inTime: now,
        },
      });

      // Update clock in time if this is the first session of the day
      if (!attendance.clockInTime) {
        await this.prisma.attendanceRecord.update({
          where: { id: attendance.id },
          data: {
            clockInTime: now,
            status: 'PRESENT',
            source: dto.source || 'WEB',
            remarks: dto.remarks,
            clockInLatitude: dto.latitude,
            clockInLongitude: dto.longitude,
          },
        });
      }
    } else {
      // Create new attendance record with first session
      attendance = await this.prisma.attendanceRecord.create({
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
          standardWorkMinutes: 480, // 8 hours default
          sessions: {
            create: {
              inTime: now,
            },
          },
        },
        include: { sessions: true },
      });
    }

    return this.getAttendanceById(tenantId, attendance.id);
  }

  /**
   * Clock out for an employee
   */
  async clockOut(tenantId: string, employeeId: string, dto: ClockOutDto) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Get today's attendance
    const attendance = await this.prisma.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: today,
        },
      },
      include: { sessions: true },
    });

    if (!attendance) {
      throw new BadRequestException('No clock-in record found for today');
    }

    // Find open session
    const openSession = attendance.sessions.find((s) => !s.outTime);
    if (!openSession) {
      throw new BadRequestException('No open session found. Please clock in first.');
    }

    // Calculate session minutes
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
      },
    });

    return this.getAttendanceById(tenantId, attendance.id);
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
    const date = new Date(dto.date);
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

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
  async getTodayStatus(tenantId: string, employeeId: string) {
    const today = new Date();
    const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

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
    const isClockedIn = lastSession && !lastSession.outTime;

    return {
      status: attendance.status,
      clockedIn: isClockedIn,
      clockInTime: attendance.clockInTime,
      clockOutTime: attendance.clockOutTime,
      workedMinutes: attendance.workedMinutes,
      otMinutesCalculated: attendance.otMinutesCalculated,
      currentSessionStart: isClockedIn ? lastSession.inTime : null,
      clockInLatitude: attendance.clockInLatitude,
      clockInLongitude: attendance.clockInLongitude,
      clockOutLatitude: attendance.clockOutLatitude,
      clockOutLongitude: attendance.clockOutLongitude,
    };
  }
}
