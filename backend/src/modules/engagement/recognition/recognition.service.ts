import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { EngagementSettingsService } from '../settings/engagement-settings.service';
import { FeedService } from '../feed/feed.service';
import { FEED_SOURCE } from '../feed/feed.types';
import { istMonthRange } from '../engagement-time';
import { GiveRecognitionDto, WallQueryDto } from './dto/recognition.dto';

interface NameParts {
  firstName: string;
  lastName: string;
}

/** "A", "A and B", or "A, B and 2 others". */
function names(recipients: NameParts[]): string {
  const full = recipients.map((r) => `${r.firstName} ${r.lastName}`.trim());
  if (full.length === 0) return 'someone';
  if (full.length === 1) return full[0];
  if (full.length === 2) return `${full[0]} and ${full[1]}`;
  return `${full[0]}, ${full[1]} and ${full.length - 2} others`;
}

const WALL_INCLUDE = {
  giver: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  badge: { select: { id: true, name: true, icon: true, points: true } },
  recipients: {
    select: {
      id: true,
      employeeId: true,
      points: true,
      employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
    },
  },
} as const;

/** Give kudos, browse the wall, and track a caller's own monthly allowance. */
@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: EngagementSettingsService,
    private readonly feed: FeedService,
  ) {}

  async give(tenantId: string, giverId: string, dto: GiveRecognitionDto) {
    const recipientIds = [...new Set(dto.recipientIds)];
    if (recipientIds.includes(giverId)) {
      throw new BadRequestException('You cannot recognise yourself');
    }

    const recipients = await this.prisma.employee.findMany({
      where: { tenantId, id: { in: recipientIds }, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true },
    });
    if (recipients.length !== recipientIds.length) {
      throw new BadRequestException('Every recipient must be an active employee');
    }

    const badge = dto.badgeId
      ? await this.prisma.badge.findFirst({ where: { id: dto.badgeId, tenantId, isActive: true } })
      : null;
    if (dto.badgeId && !badge) {
      throw new BadRequestException('Badge not found');
    }

    const giver = await this.prisma.employee.findFirst({
      where: { id: giverId, tenantId },
      select: { firstName: true, lastName: true },
    });

    const created = await this.prisma.$transaction(async (tx) => {
      const settings = await this.settings.get(tenantId, tx);
      const per = settings.pointsEnabled ? dto.points ?? badge?.points ?? 0 : 0;
      const cost = per * recipientIds.length;

      if (cost > 0) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${giverId}))`;
        const { start, end } = istMonthRange(new Date());
        const spentAgg = await tx.recognitionRecipient.aggregate({
          _sum: { points: true },
          where: { tenantId, createdAt: { gte: start, lt: end }, recognition: { giverId } },
        });
        const spent = spentAgg._sum.points ?? 0;
        if (spent + cost > settings.monthlyPointsAllowance) {
          throw new BadRequestException(
            `Not enough points left this month (${Math.max(0, settings.monthlyPointsAllowance - spent)} remaining)`,
          );
        }
      }

      const now = new Date();
      const rec = await tx.recognition.create({
        data: {
          tenantId,
          giverId,
          badgeId: badge?.id ?? null,
          message: dto.message.trim(),
          pointsPerRecipient: per,
          createdAt: now,
          recipients: {
            create: recipientIds.map((employeeId) => ({
              tenantId,
              employeeId,
              points: per,
              createdAt: now,
            })),
          },
        },
      });

      await this.feed.post(
        {
          tenantId,
          type: 'RECOGNITION',
          sourceType: FEED_SOURCE.RECOGNITION,
          sourceId: rec.id,
          actorEmployeeId: giverId,
          title: `${giver?.firstName ?? 'Someone'} recognised ${names(recipients)}`,
          body: rec.message,
          payload: {
            badge: badge ? { name: badge.name, icon: badge.icon } : null,
            recipientIds,
            pointsPerRecipient: per,
          },
          dedupeKey: `recognition:${rec.id}`,
          occurredAt: now,
        },
        tx,
      );

      return rec;
    });

    void this.notifyRecipients(tenantId, recipientIds, giver ?? null);
    return created;
  }

  /**
   * Fire-and-forget, after the recognition transaction has committed. Never
   * rejects: the caller does not await it, so an escaped rejection would be
   * unhandled and terminate the process. Failures are logged instead.
   */
  private async notifyRecipients(
    tenantId: string,
    recipientIds: string[],
    giver: NameParts | null,
  ) {
    try {
      const users = await this.prisma.user.findMany({
        where: { tenantId, employeeId: { in: recipientIds }, isActive: true },
        select: { id: true },
      });
      if (users.length === 0) return;

      const giverName = giver ? `${giver.firstName} ${giver.lastName}`.trim() : 'Someone';
      await this.notifications.createMany(
        users.map((user) => ({
          tenantId,
          userId: user.id,
          type: NotificationType.RECOGNITION_RECEIVED,
          title: 'You were recognised!',
          message: `${giverName} recognised you.`,
          link: '/engagement/recognition',
        })),
      );
    } catch (err) {
      this.logger.error(
        `Failed to notify recognition recipients: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.recognition.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Recognition not found');

    await this.prisma.$transaction(async (tx) => {
      await this.feed.removeBySource(tenantId, FEED_SOURCE.RECOGNITION, id, tx);
      await tx.recognition.delete({ where: { id } });
    });

    return { success: true };
  }

  async wall(tenantId: string, query: WallQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = {
      tenantId,
      ...(query.employeeId ? { recipients: { some: { employeeId: query.employeeId } } } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.recognition.findMany({
        where,
        include: WALL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.recognition.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: total === 0 ? 0 : Math.ceil(total / limit) } };
  }

  async me(tenantId: string, employeeId: string) {
    const settings = await this.settings.get(tenantId);
    const { start, end } = istMonthRange(new Date());

    const spentAgg = await this.prisma.recognitionRecipient.aggregate({
      _sum: { points: true },
      where: { tenantId, createdAt: { gte: start, lt: end }, recognition: { giverId: employeeId } },
    });
    const spentThisMonth = spentAgg._sum.points ?? 0;

    const receivedAgg = await this.prisma.recognitionRecipient.aggregate({
      _sum: { points: true },
      _count: { _all: true },
      where: { tenantId, employeeId },
    });

    return {
      pointsEnabled: settings.pointsEnabled,
      allowance: settings.monthlyPointsAllowance,
      spentThisMonth,
      remainingThisMonth: Math.max(0, settings.monthlyPointsAllowance - spentThisMonth),
      receivedPointsTotal: receivedAgg._sum.points ?? 0,
      receivedCountTotal: receivedAgg._count?._all ?? 0,
    };
  }
}
