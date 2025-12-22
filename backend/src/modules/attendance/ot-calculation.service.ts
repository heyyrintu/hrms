import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmploymentType, OtRule } from '@prisma/client';

/**
 * Service for calculating overtime based on configurable OT rules
 */
@Injectable()
export class OtCalculationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Get applicable OT rule for an employee
   */
  async getOtRule(tenantId: string, employmentType: EmploymentType): Promise<OtRule | null> {
    // First try to find a rule specific to the employment type
    let rule = await this.prisma.otRule.findFirst({
      where: {
        tenantId,
        employmentType,
        isActive: true,
      },
    });

    // If no specific rule, try to find a default rule (null employment type)
    if (!rule) {
      rule = await this.prisma.otRule.findFirst({
        where: {
          tenantId,
          employmentType: null,
          isActive: true,
        },
      });
    }

    return rule;
  }

  /**
   * Calculate OT minutes based on worked minutes and OT rule
   */
  calculateOtMinutes(
    workedMinutes: number,
    standardWorkMinutes: number,
    rule: OtRule | null,
  ): number {
    if (!rule) {
      // Default calculation: OT = worked - standard (if positive)
      return Math.max(0, workedMinutes - standardWorkMinutes);
    }

    const threshold = rule.dailyThresholdMinutes || standardWorkMinutes;
    let otMinutes = Math.max(0, workedMinutes - threshold);

    // Apply rounding
    if (rule.roundingIntervalMinutes && rule.roundingIntervalMinutes > 0) {
      otMinutes = this.roundMinutes(otMinutes, rule.roundingIntervalMinutes);
    }

    // Apply max OT per day limit
    if (rule.maxOtPerDayMinutes && otMinutes > rule.maxOtPerDayMinutes) {
      otMinutes = rule.maxOtPerDayMinutes;
    }

    return otMinutes;
  }

  /**
   * Round minutes based on interval
   * e.g., 15-minute rounding: 7 mins -> 0, 8 mins -> 15, 23 mins -> 15, 24 mins -> 30
   */
  private roundMinutes(minutes: number, interval: number): number {
    if (interval <= 0) return minutes;
    
    const remainder = minutes % interval;
    const halfInterval = interval / 2;
    
    if (remainder >= halfInterval) {
      return minutes + (interval - remainder);
    } else {
      return minutes - remainder;
    }
  }

  /**
   * Calculate total worked minutes from sessions
   */
  calculateWorkedMinutesFromSessions(
    sessions: Array<{ inTime: Date; outTime: Date | null }>,
  ): number {
    return sessions.reduce((total, session) => {
      if (!session.outTime) return total;
      
      const diffMs = session.outTime.getTime() - session.inTime.getTime();
      const diffMinutes = Math.floor(diffMs / (1000 * 60));
      
      return total + Math.max(0, diffMinutes);
    }, 0);
  }

  /**
   * Calculate worked minutes from clock in/out times
   */
  calculateWorkedMinutes(
    clockInTime: Date | null,
    clockOutTime: Date | null,
    breakMinutes: number = 0,
  ): number {
    if (!clockInTime || !clockOutTime) return 0;

    const diffMs = clockOutTime.getTime() - clockInTime.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    return Math.max(0, diffMinutes - breakMinutes);
  }

  /**
   * Check if OT for a month exceeds the maximum allowed
   */
  async checkMonthlyOtLimit(
    tenantId: string,
    employeeId: string,
    rule: OtRule,
    additionalOtMinutes: number,
  ): Promise<{ exceeded: boolean; currentTotal: number; limit: number | null }> {
    if (!rule.maxOtPerMonthMinutes) {
      return { exceeded: false, currentTotal: 0, limit: null };
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const result = await this.prisma.attendanceRecord.aggregate({
      where: {
        tenantId,
        employeeId,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        otMinutesApproved: true,
      },
    });

    const currentTotal = result._sum.otMinutesApproved || 0;
    const exceeded = currentTotal + additionalOtMinutes > rule.maxOtPerMonthMinutes;

    return {
      exceeded,
      currentTotal,
      limit: rule.maxOtPerMonthMinutes,
    };
  }
}
