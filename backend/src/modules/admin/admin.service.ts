import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOtRuleDto, UpdateOtRuleDto } from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all OT rules
   */
  async getOtRules(tenantId: string) {
    return this.prisma.otRule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get OT rule by ID
   */
  async getOtRule(tenantId: string, id: string) {
    const rule = await this.prisma.otRule.findFirst({
      where: { id, tenantId },
    });

    if (!rule) {
      throw new NotFoundException('OT rule not found');
    }

    return rule;
  }

  /**
   * Create OT rule
   */
  async createOtRule(tenantId: string, dto: CreateOtRuleDto) {
    // Check if rule for this employment type already exists
    if (dto.employmentType) {
      const existing = await this.prisma.otRule.findUnique({
        where: {
          tenantId_employmentType: {
            tenantId,
            employmentType: dto.employmentType,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `OT rule for ${dto.employmentType} already exists`,
        );
      }
    }

    return this.prisma.otRule.create({
      data: {
        tenantId,
        name: dto.name,
        employmentType: dto.employmentType,
        dailyThresholdMinutes: dto.dailyThresholdMinutes || 480,
        weeklyThresholdMinutes: dto.weeklyThresholdMinutes,
        roundingIntervalMinutes: dto.roundingIntervalMinutes || 15,
        requiresManagerApproval: dto.requiresManagerApproval !== false,
        maxOtPerDayMinutes: dto.maxOtPerDayMinutes,
        maxOtPerMonthMinutes: dto.maxOtPerMonthMinutes,
      },
    });
  }

  /**
   * Update OT rule
   */
  async updateOtRule(tenantId: string, id: string, dto: UpdateOtRuleDto) {
    await this.getOtRule(tenantId, id);

    return this.prisma.otRule.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * Delete OT rule
   */
  async deleteOtRule(tenantId: string, id: string) {
    await this.getOtRule(tenantId, id);

    return this.prisma.otRule.delete({
      where: { id },
    });
  }

  /**
   * Get dashboard statistics
   */
  async getDashboardStats(tenantId: string) {
    const today = new Date();
    const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const [
      totalEmployees,
      activeEmployees,
      presentToday,
      onLeaveToday,
      pendingLeaveRequests,
      pendingOtApprovals,
    ] = await Promise.all([
      this.prisma.employee.count({ where: { tenantId } }),
      this.prisma.employee.count({ where: { tenantId, status: 'ACTIVE' } }),
      this.prisma.attendanceRecord.count({
        where: {
          tenantId,
          date: dateOnly,
          status: 'PRESENT',
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          tenantId,
          date: dateOnly,
          status: 'LEAVE',
        },
      }),
      this.prisma.leaveRequest.count({
        where: {
          tenantId,
          status: 'PENDING',
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          tenantId,
          otMinutesCalculated: { gt: 0 },
          otMinutesApproved: null,
        },
      }),
    ]);

    return {
      totalEmployees,
      activeEmployees,
      presentToday,
      onLeaveToday,
      pendingLeaveRequests,
      pendingOtApprovals,
    };
  }

  /**
   * Get dashboard stats for a manager (their team only)
   */
  async getManagerDashboardStats(tenantId: string, managerId: string) {
    const today = new Date();
    const dateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Get direct reports
    const directReports = await this.prisma.employee.findMany({
      where: { tenantId, managerId, status: 'ACTIVE' },
      select: { id: true },
    });

    const employeeIds = directReports.map((e) => e.id);

    const [
      teamSize,
      presentToday,
      onLeaveToday,
      pendingLeaveRequests,
      pendingOtApprovals,
    ] = await Promise.all([
      directReports.length,
      this.prisma.attendanceRecord.count({
        where: {
          tenantId,
          employeeId: { in: employeeIds },
          date: dateOnly,
          status: 'PRESENT',
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          tenantId,
          employeeId: { in: employeeIds },
          date: dateOnly,
          status: 'LEAVE',
        },
      }),
      this.prisma.leaveRequest.count({
        where: {
          tenantId,
          employeeId: { in: employeeIds },
          status: 'PENDING',
        },
      }),
      this.prisma.attendanceRecord.count({
        where: {
          tenantId,
          employeeId: { in: employeeIds },
          otMinutesCalculated: { gt: 0 },
          otMinutesApproved: null,
        },
      }),
    ]);

    return {
      teamSize,
      presentToday,
      onLeaveToday,
      pendingLeaveRequests,
      pendingOtApprovals,
    };
  }
}
