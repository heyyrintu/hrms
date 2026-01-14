import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateLeaveRequestDto,
  ApproveLeaveDto,
  RejectLeaveDto,
  LeaveRequestQueryDto,
  CreateLeaveTypeDto,
  UpdateLeaveBalanceDto,
  AdminLeaveRequestQueryDto,
  InitializeBalancesDto,
} from './dto/leave.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class LeaveService {
  constructor(private prisma: PrismaService) { }

  /**
   * Get leave balances for an employee
   */
  async getBalances(tenantId: string, employeeId: string, year?: number) {
    const targetYear = year || new Date().getFullYear();

    return this.prisma.leaveBalance.findMany({
      where: {
        tenantId,
        employeeId,
        year: targetYear,
      },
      include: {
        leaveType: true,
      },
    });
  }

  /**
   * Create a leave request
   */
  async createRequest(tenantId: string, employeeId: string, dto: CreateLeaveRequestDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    // Validate dates
    if (startDate > endDate) {
      throw new BadRequestException('Start date cannot be after end date');
    }

    // Calculate total days
    const totalDays = this.calculateLeaveDays(startDate, endDate);

    // Check if leave type exists
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id: dto.leaveTypeId, tenantId, isActive: true },
    });

    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }

    // Check for overlapping leave requests
    const overlapping = await this.prisma.leaveRequest.findFirst({
      where: {
        tenantId,
        employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        OR: [
          {
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        ],
      },
    });

    if (overlapping) {
      throw new ConflictException('Leave request overlaps with an existing request');
    }

    // Check leave balance
    const balance = await this.prisma.leaveBalance.findFirst({
      where: {
        tenantId,
        employeeId,
        leaveTypeId: dto.leaveTypeId,
        year: startDate.getFullYear(),
      },
    });

    const availableDays = balance
      ? Number(balance.totalDays) + Number(balance.carriedOver) - Number(balance.usedDays) - Number(balance.pendingDays)
      : 0;

    if (totalDays > availableDays && leaveType.code !== 'LOP') {
      throw new BadRequestException(
        `Insufficient leave balance. Available: ${availableDays}, Requested: ${totalDays}`,
      );
    }

    // Create leave request
    const request = await this.prisma.leaveRequest.create({
      data: {
        tenantId,
        employeeId,
        leaveTypeId: dto.leaveTypeId,
        startDate,
        endDate,
        totalDays,
        reason: dto.reason,
        status: 'PENDING',
      },
      include: {
        leaveType: true,
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

    // Update pending days in balance
    if (balance) {
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          pendingDays: { increment: totalDays },
        },
      });
    }

    return request;
  }

  /**
   * Get leave requests for an employee
   */
  async getMyRequests(tenantId: string, employeeId: string, query: LeaveRequestQueryDto) {
    const { from, to, status, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      tenantId,
      employeeId,
    };

    if (from && to) {
      where.startDate = {
        gte: new Date(from),
        lte: new Date(to),
      };
    }

    if (status) {
      where.status = status;
    }

    const [requests, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          leaveType: true,
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return {
      data: requests,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get pending approvals for a manager
   */
  async getPendingApprovals(tenantId: string, managerId: string) {
    // Get direct reports
    const directReports = await this.prisma.employee.findMany({
      where: {
        tenantId,
        managerId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    const employeeIds = directReports.map((e) => e.id);

    return this.prisma.leaveRequest.findMany({
      where: {
        tenantId,
        employeeId: { in: employeeIds },
        status: 'PENDING',
      },
      orderBy: { createdAt: 'asc' },
      include: {
        leaveType: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: true,
          },
        },
      },
    });
  }

  /**
   * Approve a leave request
   */
  async approveRequest(
    tenantId: string,
    requestId: string,
    approverId: string,
    dto: ApproveLeaveDto,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, tenantId, status: 'PENDING' },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found or already processed');
    }

    // Update request
    const updated = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        approverId,
        approverNote: dto.approverNote,
        approvedAt: new Date(),
      },
      include: {
        leaveType: true,
        employee: true,
      },
    });

    // Update leave balance
    const balance = await this.prisma.leaveBalance.findFirst({
      where: {
        tenantId,
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getFullYear(),
      },
    });

    if (balance) {
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          usedDays: { increment: Number(request.totalDays) },
          pendingDays: { decrement: Number(request.totalDays) },
        },
      });
    }

    // Mark attendance as LEAVE for the leave dates
    await this.markAttendanceAsLeave(tenantId, request.employeeId, request.startDate, request.endDate);

    return updated;
  }

  /**
   * Reject a leave request
   */
  async rejectRequest(
    tenantId: string,
    requestId: string,
    approverId: string,
    dto: RejectLeaveDto,
  ) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: { id: requestId, tenantId, status: 'PENDING' },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found or already processed');
    }

    // Update request
    const updated = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        approverId,
        approverNote: dto.approverNote,
      },
      include: {
        leaveType: true,
        employee: true,
      },
    });

    // Update leave balance - remove from pending
    const balance = await this.prisma.leaveBalance.findFirst({
      where: {
        tenantId,
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getFullYear(),
      },
    });

    if (balance) {
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          pendingDays: { decrement: Number(request.totalDays) },
        },
      });
    }

    return updated;
  }

  /**
   * Cancel a leave request (by employee)
   */
  async cancelRequest(tenantId: string, requestId: string, employeeId: string) {
    const request = await this.prisma.leaveRequest.findFirst({
      where: {
        id: requestId,
        tenantId,
        employeeId,
        status: 'PENDING',
      },
    });

    if (!request) {
      throw new NotFoundException('Leave request not found or cannot be cancelled');
    }

    // Update request
    const updated = await this.prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' },
    });

    // Update leave balance
    const balance = await this.prisma.leaveBalance.findFirst({
      where: {
        tenantId,
        employeeId: request.employeeId,
        leaveTypeId: request.leaveTypeId,
        year: request.startDate.getFullYear(),
      },
    });

    if (balance) {
      await this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          pendingDays: { decrement: Number(request.totalDays) },
        },
      });
    }

    return updated;
  }

  /**
   * Get all leave types
   */
  async getLeaveTypes(tenantId: string) {
    return this.prisma.leaveType.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Create a leave type
   */
  async createLeaveType(tenantId: string, dto: CreateLeaveTypeDto) {
    const existing = await this.prisma.leaveType.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: dto.code,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Leave type code already exists');
    }

    return this.prisma.leaveType.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        description: dto.description,
        defaultDays: dto.defaultDays || 0,
        carryForward: dto.carryForward || false,
        maxCarryForward: dto.maxCarryForward,
        isPaid: dto.isPaid !== false,
      },
    });
  }

  /**
   * Update leave balance for an employee
   */
  async updateBalance(
    tenantId: string,
    employeeId: string,
    leaveTypeId: string,
    year: number,
    dto: UpdateLeaveBalanceDto,
  ) {
    const balance = await this.prisma.leaveBalance.findFirst({
      where: {
        tenantId,
        employeeId,
        leaveTypeId,
        year,
      },
    });

    if (balance) {
      return this.prisma.leaveBalance.update({
        where: { id: balance.id },
        data: {
          totalDays: dto.totalDays,
          carriedOver: dto.carriedOver || 0,
        },
        include: { leaveType: true },
      });
    }

    return this.prisma.leaveBalance.create({
      data: {
        tenantId,
        employeeId,
        leaveTypeId,
        year,
        totalDays: dto.totalDays,
        carriedOver: dto.carriedOver || 0,
      },
      include: { leaveType: true },
    });
  }

  /**
   * Calculate leave days (excluding weekends)
   */
  private calculateLeaveDays(startDate: Date, endDate: Date): number {
    let count = 0;
    const current = new Date(startDate);

    while (current <= endDate) {
      const dayOfWeek = current.getDay();
      // Exclude Saturday (6) and Sunday (0)
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        count++;
      }
      current.setDate(current.getDate() + 1);
    }

    return count;
  }

  /**
   * Mark attendance records as LEAVE for approved leave dates
   */
  private async markAttendanceAsLeave(
    tenantId: string,
    employeeId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const current = new Date(startDate);

    while (current <= endDate) {
      const dayOfWeek = current.getDay();

      // Skip weekends
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dateOnly = new Date(current.getFullYear(), current.getMonth(), current.getDate());

        await this.prisma.attendanceRecord.upsert({
          where: {
            tenantId_employeeId_date: {
              tenantId,
              employeeId,
              date: dateOnly,
            },
          },
          update: {
            status: 'LEAVE',
          },
          create: {
            tenantId,
            employeeId,
            date: dateOnly,
            status: 'LEAVE',
            source: 'API',
            standardWorkMinutes: 480,
          },
        });
      }

      current.setDate(current.getDate() + 1);
    }
  }

  // ==========================================
  // ADMIN METHODS
  // ==========================================

  /**
   * Update a leave type
   */
  async updateLeaveType(tenantId: string, id: string, dto: CreateLeaveTypeDto) {
    const existing = await this.prisma.leaveType.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Leave type not found');
    }

    // Check if code is being changed and if new code exists
    if (dto.code !== existing.code) {
      const codeExists = await this.prisma.leaveType.findUnique({
        where: {
          tenantId_code: {
            tenantId,
            code: dto.code,
          },
        },
      });

      if (codeExists) {
        throw new ConflictException('Leave type code already exists');
      }
    }

    return this.prisma.leaveType.update({
      where: { id },
      data: {
        name: dto.name,
        code: dto.code,
        description: dto.description,
        defaultDays: dto.defaultDays,
        carryForward: dto.carryForward,
        maxCarryForward: dto.maxCarryForward,
        isPaid: dto.isPaid,
      },
    });
  }

  /**
   * Delete (deactivate) a leave type
   */
  async deleteLeaveType(tenantId: string, id: string) {
    const existing = await this.prisma.leaveType.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundException('Leave type not found');
    }

    return this.prisma.leaveType.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Get all employee balances (for admin)
   */
  async getAllBalances(tenantId: string, year?: number) {
    const targetYear = year || new Date().getFullYear();

    return this.prisma.leaveBalance.findMany({
      where: {
        tenantId,
        year: targetYear,
      },
      include: {
        leaveType: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            department: {
              select: { name: true },
            },
          },
        },
      },
      orderBy: [
        { employee: { firstName: 'asc' } },
        { leaveType: { name: 'asc' } },
      ],
    });
  }

  /**
   * Initialize balances for employees for a year
   */
  async initializeBalances(tenantId: string, dto: InitializeBalancesDto) {
    const { year, employeeIds } = dto;

    // Get all leave types
    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { tenantId, isActive: true },
    });

    // Get employees
    const employeeWhere: Record<string, unknown> = {
      tenantId,
      status: 'ACTIVE',
    };
    if (employeeIds && employeeIds.length > 0) {
      employeeWhere.id = { in: employeeIds };
    }

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      select: { id: true },
    });

    const results = {
      created: 0,
      skipped: 0,
    };

    // Create balances for each employee and leave type
    for (const employee of employees) {
      for (const leaveType of leaveTypes) {
        // Check if balance already exists
        const existing = await this.prisma.leaveBalance.findFirst({
          where: {
            tenantId,
            employeeId: employee.id,
            leaveTypeId: leaveType.id,
            year,
          },
        });

        if (!existing) {
          await this.prisma.leaveBalance.create({
            data: {
              tenantId,
              employeeId: employee.id,
              leaveTypeId: leaveType.id,
              year,
              totalDays: leaveType.defaultDays,
              usedDays: 0,
              pendingDays: 0,
              carriedOver: 0,
            },
          });
          results.created++;
        } else {
          results.skipped++;
        }
      }
    }

    return {
      message: `Balance initialization complete`,
      ...results,
      totalEmployees: employees.length,
      totalLeaveTypes: leaveTypes.length,
    };
  }

  /**
   * Get all leave requests (for admin)
   */
  async getAllRequests(tenantId: string, query: AdminLeaveRequestQueryDto) {
    const { from, to, status, employeeId, leaveTypeId, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { tenantId };

    if (from && to) {
      where.startDate = {
        gte: new Date(from),
        lte: new Date(to),
      };
    }

    if (status) {
      where.status = status;
    }

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (leaveTypeId) {
      where.leaveTypeId = leaveTypeId;
    }

    const [requests, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          leaveType: true,
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              employeeCode: true,
              department: true,
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
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);

    return {
      data: requests,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get leave analytics
   */
  async getAnalytics(tenantId: string, year?: number) {
    const targetYear = year || new Date().getFullYear();
    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31);

    // Get request counts by status
    const requestsByStatus = await this.prisma.leaveRequest.groupBy({
      by: ['status'],
      where: {
        tenantId,
        startDate: { gte: startOfYear, lte: endOfYear },
      },
      _count: { id: true },
    });

    // Get leave usage by type
    const usageByType = await this.prisma.leaveRequest.groupBy({
      by: ['leaveTypeId'],
      where: {
        tenantId,
        status: 'APPROVED',
        startDate: { gte: startOfYear, lte: endOfYear },
      },
      _sum: { totalDays: true },
      _count: { id: true },
    });

    // Get leave types for labels
    const leaveTypes = await this.prisma.leaveType.findMany({
      where: { tenantId },
    });

    const leaveTypeMap = new Map(leaveTypes.map(lt => [lt.id, lt]));

    // Get monthly leave counts
    const monthlyRequests = await this.prisma.leaveRequest.findMany({
      where: {
        tenantId,
        status: 'APPROVED',
        startDate: { gte: startOfYear, lte: endOfYear },
      },
      select: {
        startDate: true,
        totalDays: true,
      },
    });

    const monthlyData = Array(12).fill(0);
    monthlyRequests.forEach(req => {
      const month = new Date(req.startDate).getMonth();
      monthlyData[month] += Number(req.totalDays);
    });

    return {
      year: targetYear,
      requestsByStatus: requestsByStatus.reduce((acc, item) => {
        acc[item.status] = item._count.id;
        return acc;
      }, {} as Record<string, number>),
      usageByType: usageByType.map(item => ({
        leaveType: leaveTypeMap.get(item.leaveTypeId),
        totalDays: Number(item._sum.totalDays) || 0,
        requestCount: item._count.id,
      })),
      monthlyUsage: monthlyData,
    };
  }
}

