import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EngagementSettingsService } from '../settings/engagement-settings.service';
import { istPeriodRange, LeaderboardPeriod } from '../engagement-time';

export interface LeaderboardRow {
  rank: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  department: string | null;
  points: number;
  count: number;
}

/** Top 20 recognised employees for a period, ranked by points or by count. */
@Injectable()
export class RecognitionLeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: EngagementSettingsService,
  ) {}

  async leaderboard(tenantId: string, period: LeaderboardPeriod): Promise<LeaderboardRow[]> {
    const settings = await this.settings.get(tenantId);
    const { start, end } = istPeriodRange(period, new Date());

    const where: { tenantId: string; createdAt?: { gte: Date; lt: Date } } = { tenantId };
    if (start && end) where.createdAt = { gte: start, lt: end };

    const groups = await this.prisma.recognitionRecipient.groupBy({
      by: ['employeeId'],
      where,
      _sum: { points: true },
      _count: { _all: true },
    });
    if (groups.length === 0) return [];

    const employeeIds = groups.map((g) => g.employeeId);
    const employees = await this.prisma.employee.findMany({
      where: { tenantId, id: { in: employeeIds } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        department: { select: { name: true } },
      },
    });
    const byId = new Map(employees.map((e) => [e.id, e]));

    return groups
      .map((g) => {
        const emp = byId.get(g.employeeId);
        return {
          employeeId: g.employeeId,
          firstName: emp?.firstName ?? '',
          lastName: emp?.lastName ?? '',
          employeeCode: emp?.employeeCode ?? '',
          department: emp?.department?.name ?? null,
          points: g._sum.points ?? 0,
          count: g._count._all ?? 0,
        };
      })
      .sort((a, b) => {
        if (settings.pointsEnabled && b.points !== a.points) return b.points - a.points;
        if (b.count !== a.count) return b.count - a.count;
        return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
      })
      .slice(0, 20)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }
}
