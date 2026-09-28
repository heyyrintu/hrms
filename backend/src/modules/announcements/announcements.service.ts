import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '@prisma/client';
import {
  CreateAnnouncementDto,
  UpdateAnnouncementDto,
  AnnouncementQueryDto,
} from './dto/announcement.dto';
import { FeedService } from '../engagement/feed/feed.service';
import { FEED_SOURCE } from '../engagement/feed/feed.types';

@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private feed: FeedService,
  ) {}

  /**
   * Keeps the social feed in sync with an announcement's published state.
   * Feed errors are caught and logged; they must never fail the
   * announcement write itself.
   */
  private async syncFeed(
    tenantId: string,
    a: {
      id: string;
      title: string;
      content: string;
      authorId: string;
      priority: string;
      isPublished: boolean;
      publishedAt: Date | null;
    },
  ): Promise<void> {
    try {
      if (a.isPublished) {
        await this.feed.post({
          tenantId,
          type: 'ANNOUNCEMENT',
          sourceType: FEED_SOURCE.ANNOUNCEMENT,
          sourceId: a.id,
          actorEmployeeId: a.authorId,
          title: a.title,
          body: a.content.slice(0, 500),
          payload: { priority: a.priority },
          dedupeKey: `announcement:${a.id}`,
          occurredAt: a.publishedAt ?? new Date(),
        });
      } else {
        await this.feed.removeBySource(tenantId, FEED_SOURCE.ANNOUNCEMENT, a.id);
      }
    } catch (err) {
      this.logger.error(`Feed sync failed for announcement ${a.id}`, err as Error);
    }
  }

  async create(tenantId: string, authorId: string, dto: CreateAnnouncementDto) {
    const announcement = await this.prisma.announcement.create({
      data: {
        tenantId,
        authorId,
        title: dto.title,
        content: dto.content,
        priority: dto.priority,
        isPublished: dto.isPublished ?? false,
        publishedAt: dto.isPublished ? new Date() : null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
      include: {
        author: { select: { firstName: true, lastName: true } },
      },
    });

    // If published immediately, notify all users in the tenant
    if (announcement.isPublished) {
      await this.notifyAllUsers(tenantId, announcement.title);
    }

    await this.syncFeed(tenantId, announcement);

    return announcement;
  }

  async findAll(tenantId: string, query: AnnouncementQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (query.publishedOnly) {
      where.isPublished = true;
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gte: new Date() } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.announcement.findMany({
        where,
        include: {
          author: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.announcement.count({ where }),
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

  async getActive(tenantId: string) {
    const now = new Date();
    return this.prisma.announcement.findMany({
      where: {
        tenantId,
        isPublished: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: now } },
        ],
      },
      include: {
        author: { select: { firstName: true, lastName: true } },
      },
      orderBy: [
        { priority: 'desc' },
        { publishedAt: 'desc' },
      ],
      take: 10,
    });
  }

  async findById(tenantId: string, id: string) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { id, tenantId },
      include: {
        author: { select: { firstName: true, lastName: true } },
      },
    });

    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    return announcement;
  }

  async update(tenantId: string, id: string, dto: UpdateAnnouncementDto) {
    const existing = await this.findById(tenantId, id);

    const wasPublished = existing.isPublished;
    const data: any = { ...dto };

    if (dto.expiresAt) {
      data.expiresAt = new Date(dto.expiresAt);
    }

    // Set publishedAt when publishing for the first time
    if (dto.isPublished && !wasPublished) {
      data.publishedAt = new Date();
    }

    const updated = await this.prisma.announcement.update({
      where: { id },
      data,
      include: {
        author: { select: { firstName: true, lastName: true } },
      },
    });

    // Notify users when newly published
    if (dto.isPublished && !wasPublished) {
      await this.notifyAllUsers(tenantId, updated.title);
    }

    if (dto.isPublished !== undefined && dto.isPublished !== wasPublished) {
      await this.syncFeed(tenantId, updated);
    }

    return updated;
  }

  async delete(tenantId: string, id: string) {
    await this.findById(tenantId, id);
    await this.prisma.announcement.delete({ where: { id } });
    try {
      await this.feed.removeBySource(tenantId, FEED_SOURCE.ANNOUNCEMENT, id);
    } catch (err) {
      this.logger.error(`Feed sync failed for announcement ${id}`, err as Error);
    }
    return { message: 'Announcement deleted' };
  }

  private async notifyAllUsers(tenantId: string, announcementTitle: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true },
      select: { id: true },
    });

    if (users.length === 0) return;

    await this.notificationsService.createMany(
      users.map((u) => ({
        tenantId,
        userId: u.id,
        type: NotificationType.ANNOUNCEMENT,
        title: 'New Announcement',
        message: announcementTitle,
        link: '/dashboard',
      })),
    );
  }
}
