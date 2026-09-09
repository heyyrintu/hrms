import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from '../../common/utils/prisma-errors';
import { NotificationsService } from '../notifications/notifications.service';
import { OtCalculationService } from './ot-calculation.service';
import {
  CreateRegularizationDto,
  ApproveRegularizationDto,
  RegularizationQueryDto,
} from './dto/regularization.dto';
import { RegularizationStatus, UserRole, NotificationType } from '@prisma/client';

@Injectable()
export class RegularizationService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private otCalculation: OtCalculationService,
  ) {}

  /**
   * Create a regularization request
   */
  async create(
    tenantId: string,
    employeeId: string,
    dto: CreateRegularizationDto,
  ) {
    const date = new Date(dto.date);
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    // Check if employee exists
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId, status: 'ACTIVE' },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found or inactive');
    }

    // Check for duplicate request
    const existing = await this.prisma.attendanceRegularization.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: dateOnly,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'A regularization request already exists for this date',
      );
    }

    // Fetch original attendance record times (if any)
    const attendanceRecord = await this.prisma.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId,
          date: dateOnly,
        },
      },
    });

    const regularization = await this.prisma.attendanceRegularization.create({
      data: {
        tenantId,
        employeeId,
        date: dateOnly,
        originalClockIn: attendanceRecord?.clockInTime || null,
        originalClockOut: attendanceRecord?.clockOutTime || null,
        requestedClockIn: new Date(dto.requestedClockIn),
        requestedClockOut: new Date(dto.requestedClockOut),
        reason: dto.reason,
        status: RegularizationStatus.PENDING,
      },
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
      },
    });

    return regularization;
  }

  /**
   * Get my regularization requests (paginated with optional status filter)
   */
  async getMyRequests(
    tenantId: string,
    employeeId: string,
    query: RegularizationQueryDto,
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      tenantId,
      employeeId,
    };

    if (query.status) {
      where.status = query.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({
        where,
        include: {
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.attendanceRegularization.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get pending approvals for a manager (direct reports only)
   * HR_ADMIN and SUPER_ADMIN see all pending
   */
  async getPendingApprovals(
    tenantId: string,
    managerId: string | undefined,
    role: UserRole,
  ) {
    const where: any = {
      tenantId,
      status: RegularizationStatus.PENDING,
    };

    // Managers can only see their direct reports
    if (role === UserRole.MANAGER && managerId) {
      where.employee = {
        managerId,
      };
    }

    return this.prisma.attendanceRegularization.findMany({
      where,
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
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Approve a regularization request
   * On approval, update the AttendanceRecord's clockInTime and clockOutTime
   */
  async approve(
    tenantId: string,
    id: string,
    approverId: string | undefined,
    role: UserRole,
    dto: ApproveRegularizationDto,
  ) {
    const regularization = await this.prisma.attendanceRegularization.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            managerId: true,
          },
        },
      },
    });

    if (!regularization) {
      throw new NotFoundException('Regularization request not found');
    }

    if (regularization.status !== RegularizationStatus.PENDING) {
      throw new BadRequestException('This request has already been processed');
    }

    // Manager scope check: only approve direct reports
    if (role === UserRole.MANAGER && approverId) {
      if (regularization.employee.managerId !== approverId) {
        throw new ForbiddenException(
          'You can only approve requests from your direct reports',
        );
      }
    }

    // Status-guarded transition: a concurrent approve/reject makes this throw
    // 409 instead of rewriting the attendance record twice.
    const updated = await this.transitionPending(id, {
      status: RegularizationStatus.APPROVED,
      approverId: approverId || null,
      approverNote: dto.approverNote || null,
      approvedAt: new Date(),
    });

    // Update the actual AttendanceRecord
    const dateOnly = new Date(regularization.date);
    const clockIn = new Date(regularization.requestedClockIn);
    const clockOut = new Date(regularization.requestedClockOut);
    const workedMinutes = Math.max(
      0,
      Math.floor((clockOut.getTime() - clockIn.getTime()) / (1000 * 60)),
    );

    const existingAttendance = await this.prisma.attendanceRecord.findUnique({
      where: {
        tenantId_employeeId_date: {
          tenantId,
          employeeId: regularization.employeeId,
          date: dateOnly,
        },
      },
    });

    const standardWorkMinutes = existingAttendance?.standardWorkMinutes ?? 480;

    // Overtime has to follow the corrected hours. Leaving the previous value
    // means a regularized ten-hour day never surfaces for OT approval.
    const employee = await this.prisma.employee.findFirst({
      where: { id: regularization.employeeId, tenantId },
      select: { employmentType: true },
    });
    const otRule = employee
      ? await this.otCalculation.getOtRule(tenantId, employee.employmentType)
      : null;
    const otMinutesCalculated = this.otCalculation.calculateOtMinutes(
      workedMinutes,
      standardWorkMinutes,
      otRule,
    );

    let attendanceId: string;
    if (existingAttendance) {
      // Update existing attendance record
      await this.prisma.attendanceRecord.update({
        where: { id: existingAttendance.id },
        data: {
          clockInTime: clockIn,
          clockOutTime: clockOut,
          workedMinutes,
          otMinutesCalculated,
          status: 'PRESENT',
        },
      });
      attendanceId = existingAttendance.id;
    } else {
      // Create a new attendance record
      const created = await this.prisma.attendanceRecord.create({
        data: {
          tenantId,
          employeeId: regularization.employeeId,
          date: dateOnly,
          clockInTime: clockIn,
          clockOutTime: clockOut,
          workedMinutes,
          otMinutesCalculated,
          status: 'PRESENT',
          source: 'API',
          standardWorkMinutes,
          remarks: `Regularized: ${regularization.reason}`,
        },
      });
      attendanceId = created.id;
    }

    // Sessions would otherwise still describe the original punches and
    // contradict the corrected clock times on the parent record.
    await this.prisma.attendanceSession.deleteMany({ where: { attendanceId } });
    await this.prisma.attendanceSession.create({
      data: {
        attendanceId,
        inTime: clockIn,
        outTime: clockOut,
        sessionMinutes: workedMinutes,
      },
    });

    // Fire-and-forget notification
    this.notificationsService
      .notifyEmployee(
        tenantId,
        regularization.employeeId,
        NotificationType.ATTENDANCE_REGULARIZATION_APPROVED,
        'Regularization Approved',
        `Your attendance regularization request for ${dateOnly.toLocaleDateString()} has been approved.`,
        '/attendance/regularization',
      )
      .catch(() => {}); // Fire and forget

    return updated;
  }

  /**
   * Reject a regularization request
   */
  async reject(
    tenantId: string,
    id: string,
    approverId: string | undefined,
    role: UserRole,
    dto: ApproveRegularizationDto,
  ) {
    const regularization = await this.prisma.attendanceRegularization.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            managerId: true,
          },
        },
      },
    });

    if (!regularization) {
      throw new NotFoundException('Regularization request not found');
    }

    if (regularization.status !== RegularizationStatus.PENDING) {
      throw new BadRequestException('This request has already been processed');
    }

    // Manager scope check
    if (role === UserRole.MANAGER && approverId) {
      if (regularization.employee.managerId !== approverId) {
        throw new ForbiddenException(
          'You can only reject requests from your direct reports',
        );
      }
    }

    const updated = await this.transitionPending(id, {
      status: RegularizationStatus.REJECTED,
      approverId: approverId || null,
      approverNote: dto.approverNote || null,
      approvedAt: new Date(),
    });

    // Fire-and-forget notification
    this.notificationsService
      .notifyEmployee(
        tenantId,
        regularization.employeeId,
        NotificationType.ATTENDANCE_REGULARIZATION_REJECTED,
        'Regularization Rejected',
        `Your attendance regularization request for ${new Date(regularization.date).toLocaleDateString()} has been rejected.${dto.approverNote ? ` Note: ${dto.approverNote}` : ''}`,
        '/attendance/regularization',
      )
      .catch(() => {}); // Fire and forget

    return updated;
  }

  /**
   * Move a PENDING regularization to a terminal status. The where-clause
   * includes the status so a concurrent reviewer cannot transition it twice;
   * Prisma raises P2025 when the row no longer matches.
   */
  private async transitionPending(
    id: string,
    data: {
      status: RegularizationStatus;
      approverId: string | null;
      approverNote: string | null;
      approvedAt: Date;
    },
  ) {
    try {
      return await this.prisma.attendanceRegularization.update({
        where: { id, status: RegularizationStatus.PENDING },
        data,
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
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException('This request has already been processed');
      }
      throw err;
    }
  }

  /**
   * Get all regularization requests (admin view)
   */
  async getAllRequests(tenantId: string, query: RegularizationQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };

    if (query.status) {
      where.status = query.status;
    }

    const [data, total] = await Promise.all([
      this.prisma.attendanceRegularization.findMany({
        where,
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
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.attendanceRegularization.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
