import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, createMockNotificationsService } from '../../test/helpers';
import { NotificationType } from '@prisma/client';
import { FeedService } from '../engagement/feed/feed.service';

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let prisma: any;
  let notificationsService: any;
  let feed: { post: jest.Mock; refresh: jest.Mock; removeBySource: jest.Mock };

  const tenantId = 'tenant-1';
  const authorId = 'emp-author';

  beforeEach(async () => {
    feed = {
      post: jest.fn().mockResolvedValue({ id: 'feed-1', created: true }),
      refresh: jest.fn().mockResolvedValue({ id: 'feed-1' }),
      removeBySource: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        { provide: FeedService, useValue: feed },
      ],
    }).compile();

    service = module.get<AnnouncementsService>(AnnouncementsService);
    prisma = module.get(PrismaService);
    notificationsService = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // create
  // ============================================

  describe('create', () => {
    it('should create an unpublished announcement without sending notifications', async () => {
      const dto = {
        title: 'Office Closed',
        content: 'Office will be closed on Friday',
        priority: 'NORMAL' as any,
        isPublished: false,
      };
      const mockAnnouncement = {
        id: 'ann-1',
        tenantId,
        authorId,
        ...dto,
        publishedAt: null,
        expiresAt: null,
        isPublished: false,
        author: { firstName: 'John', lastName: 'Doe' },
      };
      prisma.announcement.create.mockResolvedValue(mockAnnouncement);

      const result = await service.create(tenantId, authorId, dto);

      expect(prisma.announcement.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          authorId,
          title: 'Office Closed',
          content: 'Office will be closed on Friday',
          priority: 'NORMAL',
          isPublished: false,
          publishedAt: null,
          expiresAt: null,
        },
        include: {
          author: { select: { firstName: true, lastName: true } },
        },
      });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(notificationsService.createMany).not.toHaveBeenCalled();
      expect(result).toEqual(mockAnnouncement);
    });

    it('should create a published announcement and notify all active users', async () => {
      const dto = {
        title: 'Holiday Notice',
        content: 'Republic Day holiday on Jan 26',
        isPublished: true,
      };
      const mockAnnouncement = {
        id: 'ann-2',
        tenantId,
        authorId,
        ...dto,
        isPublished: true,
        publishedAt: expect.any(Date),
        expiresAt: null,
        author: { firstName: 'Jane', lastName: 'Doe' },
      };
      prisma.announcement.create.mockResolvedValue(mockAnnouncement);

      // notifyAllUsers calls prisma.user.findMany + notificationsService.createMany
      const mockUsers = [{ id: 'u-1' }, { id: 'u-2' }];
      prisma.user.findMany.mockResolvedValue(mockUsers);

      const result = await service.create(tenantId, authorId, dto);

      expect(prisma.announcement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isPublished: true,
            publishedAt: expect.any(Date),
          }),
        }),
      );
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId, isActive: true },
        select: { id: true },
      });
      expect(notificationsService.createMany).toHaveBeenCalledWith(
        mockUsers.map((u) => ({
          tenantId,
          userId: u.id,
          type: NotificationType.ANNOUNCEMENT,
          title: 'New Announcement',
          message: 'Holiday Notice',
          link: '/dashboard',
        })),
      );
      expect(result).toEqual(mockAnnouncement);
    });

    it('should handle expiresAt date conversion', async () => {
      const dto = {
        title: 'Limited Event',
        content: 'Expires soon',
        expiresAt: '2026-03-01',
      };
      const mockAnnouncement = {
        id: 'ann-3',
        tenantId,
        ...dto,
        isPublished: false,
        publishedAt: null,
        expiresAt: new Date('2026-03-01'),
        author: { firstName: 'John', lastName: 'Doe' },
      };
      prisma.announcement.create.mockResolvedValue(mockAnnouncement);

      await service.create(tenantId, authorId, dto);

      expect(prisma.announcement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: new Date('2026-03-01'),
          }),
        }),
      );
    });

    it('should default isPublished to false when not provided', async () => {
      const dto = {
        title: 'Draft',
        content: 'Draft content',
      };
      const mockAnnouncement = {
        id: 'ann-4',
        isPublished: false,
        publishedAt: null,
        author: { firstName: 'John', lastName: 'Doe' },
      };
      prisma.announcement.create.mockResolvedValue(mockAnnouncement);

      await service.create(tenantId, authorId, dto);

      expect(prisma.announcement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isPublished: false,
            publishedAt: null,
          }),
        }),
      );
    });
  });

  // ============================================
  // findAll
  // ============================================

  describe('findAll', () => {
    it('should return paginated announcements with defaults', async () => {
      const mockData = [
        { id: 'ann-1', title: 'Test', author: { firstName: 'A', lastName: 'B' } },
      ];
      prisma.announcement.findMany.mockResolvedValue(mockData);
      prisma.announcement.count.mockResolvedValue(1);

      const result = await service.findAll(tenantId, {});

      expect(prisma.announcement.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        include: {
          author: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(result).toEqual({
        data: mockData,
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      });
    });

    it('should paginate with custom page and limit', async () => {
      prisma.announcement.findMany.mockResolvedValue([]);
      prisma.announcement.count.mockResolvedValue(30);

      const result = await service.findAll(tenantId, { page: 2, limit: 5 });

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
        }),
      );
      expect(result.meta).toEqual({
        total: 30,
        page: 2,
        limit: 5,
        totalPages: 6,
      });
    });

    it('should filter by publishedOnly and non-expired when publishedOnly is true', async () => {
      prisma.announcement.findMany.mockResolvedValue([]);
      prisma.announcement.count.mockResolvedValue(0);

      await service.findAll(tenantId, { publishedOnly: true });

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            isPublished: true,
            OR: [
              { expiresAt: null },
              { expiresAt: { gte: expect.any(Date) } },
            ],
          },
        }),
      );
    });

    it('should not filter by published status when publishedOnly is not set', async () => {
      prisma.announcement.findMany.mockResolvedValue([]);
      prisma.announcement.count.mockResolvedValue(0);

      await service.findAll(tenantId, {});

      expect(prisma.announcement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId },
        }),
      );
    });
  });

  // ============================================
  // getActive
  // ============================================

  describe('getActive', () => {
    it('should return active published non-expired announcements sorted by priority', async () => {
      const mockActive = [
        { id: 'ann-1', title: 'Urgent', priority: 'HIGH', isPublished: true },
        { id: 'ann-2', title: 'Normal', priority: 'NORMAL', isPublished: true },
      ];
      prisma.announcement.findMany.mockResolvedValue(mockActive);

      const result = await service.getActive(tenantId);

      expect(prisma.announcement.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          isPublished: true,
          OR: [
            { expiresAt: null },
            { expiresAt: { gte: expect.any(Date) } },
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
      expect(result).toEqual(mockActive);
    });

    it('should return empty array when no active announcements', async () => {
      prisma.announcement.findMany.mockResolvedValue([]);

      const result = await service.getActive(tenantId);

      expect(result).toEqual([]);
    });
  });

  // ============================================
  // findById
  // ============================================

  describe('findById', () => {
    it('should return an announcement by id', async () => {
      const mockAnn = {
        id: 'ann-1',
        tenantId,
        title: 'Test',
        author: { firstName: 'John', lastName: 'Doe' },
      };
      prisma.announcement.findFirst.mockResolvedValue(mockAnn);

      const result = await service.findById(tenantId, 'ann-1');

      expect(prisma.announcement.findFirst).toHaveBeenCalledWith({
        where: { id: 'ann-1', tenantId },
        include: {
          author: { select: { firstName: true, lastName: true } },
        },
      });
      expect(result).toEqual(mockAnn);
    });

    it('should throw NotFoundException when announcement not found', async () => {
      prisma.announcement.findFirst.mockResolvedValue(null);

      await expect(service.findById(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================
  // update
  // ============================================

  describe('update', () => {
    const existingUnpublished = {
      id: 'ann-1',
      tenantId,
      title: 'Draft',
      content: 'Old content',
      isPublished: false,
      author: { firstName: 'John', lastName: 'Doe' },
    };

    const existingPublished = {
      id: 'ann-2',
      tenantId,
      title: 'Published',
      content: 'Published content',
      isPublished: true,
      author: { firstName: 'Jane', lastName: 'Smith' },
    };

    it('should update an announcement without publishing', async () => {
      prisma.announcement.findFirst.mockResolvedValue(existingUnpublished);
      const updated = { ...existingUnpublished, title: 'Updated Title' };
      prisma.announcement.update.mockResolvedValue(updated);

      const result = await service.update(tenantId, 'ann-1', {
        title: 'Updated Title',
      });

      expect(prisma.announcement.update).toHaveBeenCalledWith({
        where: { id: 'ann-1' },
        data: { title: 'Updated Title' },
        include: {
          author: { select: { firstName: true, lastName: true } },
        },
      });
      expect(notificationsService.createMany).not.toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('should set publishedAt and notify users when publishing for the first time', async () => {
      prisma.announcement.findFirst.mockResolvedValue(existingUnpublished);
      const published = {
        ...existingUnpublished,
        isPublished: true,
        publishedAt: expect.any(Date),
        title: 'Draft',
      };
      prisma.announcement.update.mockResolvedValue(published);
      prisma.user.findMany.mockResolvedValue([{ id: 'u-1' }]);

      const result = await service.update(tenantId, 'ann-1', {
        isPublished: true,
      });

      expect(prisma.announcement.update).toHaveBeenCalledWith({
        where: { id: 'ann-1' },
        data: {
          isPublished: true,
          publishedAt: expect.any(Date),
        },
        include: {
          author: { select: { firstName: true, lastName: true } },
        },
      });
      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId, isActive: true },
        select: { id: true },
      });
      expect(notificationsService.createMany).toHaveBeenCalled();
      expect(result).toEqual(published);
    });

    it('should NOT re-notify users when updating an already published announcement', async () => {
      prisma.announcement.findFirst.mockResolvedValue(existingPublished);
      const updated = { ...existingPublished, content: 'Updated content' };
      prisma.announcement.update.mockResolvedValue(updated);

      await service.update(tenantId, 'ann-2', {
        content: 'Updated content',
        isPublished: true,
      });

      // isPublished true but wasPublished also true, so no notification
      expect(notificationsService.createMany).not.toHaveBeenCalled();
    });

    it('should convert expiresAt string to Date', async () => {
      prisma.announcement.findFirst.mockResolvedValue(existingUnpublished);
      prisma.announcement.update.mockResolvedValue({
        ...existingUnpublished,
        expiresAt: new Date('2026-06-01'),
      });

      await service.update(tenantId, 'ann-1', {
        expiresAt: '2026-06-01',
      });

      expect(prisma.announcement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            expiresAt: new Date('2026-06-01'),
          }),
        }),
      );
    });

    it('should throw NotFoundException when announcement not found', async () => {
      prisma.announcement.findFirst.mockResolvedValue(null);

      await expect(
        service.update(tenantId, 'nonexistent', { title: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not send notifications when publishing to a tenant with no active users', async () => {
      prisma.announcement.findFirst.mockResolvedValue(existingUnpublished);
      prisma.announcement.update.mockResolvedValue({
        ...existingUnpublished,
        isPublished: true,
        title: 'Draft',
      });
      prisma.user.findMany.mockResolvedValue([]);

      await service.update(tenantId, 'ann-1', { isPublished: true });

      expect(notificationsService.createMany).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // delete
  // ============================================

  describe('delete', () => {
    it('should delete an announcement and return confirmation', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'ann-1',
        tenantId,
        title: 'Test',
        author: { firstName: 'John', lastName: 'Doe' },
      });
      prisma.announcement.delete.mockResolvedValue({});

      const result = await service.delete(tenantId, 'ann-1');

      expect(prisma.announcement.findFirst).toHaveBeenCalledWith({
        where: { id: 'ann-1', tenantId },
        include: {
          author: { select: { firstName: true, lastName: true } },
        },
      });
      expect(prisma.announcement.delete).toHaveBeenCalledWith({
        where: { id: 'ann-1' },
      });
      expect(result).toEqual({ message: 'Announcement deleted' });
    });

    it('should throw NotFoundException when trying to delete nonexistent announcement', async () => {
      prisma.announcement.findFirst.mockResolvedValue(null);

      await expect(service.delete(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================
  // feed sync
  // ============================================

  describe('feed sync', () => {
    it('posts a feed item when creating a published announcement', async () => {
      const mockAnnouncement = {
        id: 'ann-1',
        tenantId,
        authorId,
        title: 'Holiday Notice',
        content: 'Republic Day holiday on Jan 26',
        priority: 'NORMAL',
        isPublished: true,
        publishedAt: new Date('2026-03-15T12:00:00Z'),
        expiresAt: null,
        author: { firstName: 'Jane', lastName: 'Doe' },
      };
      prisma.announcement.create.mockResolvedValue(mockAnnouncement);
      prisma.user.findMany.mockResolvedValue([]);

      await service.create(tenantId, authorId, { title: 'Holiday Notice', content: 'x', isPublished: true });

      expect(feed.refresh).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          type: 'ANNOUNCEMENT',
          sourceType: 'Announcement',
          sourceId: 'ann-1',
          actorEmployeeId: authorId,
          title: 'Holiday Notice',
          dedupeKey: 'announcement:ann-1',
        }),
      );
    });

    it('does not post a feed item when creating a draft', async () => {
      const mockAnnouncement = {
        id: 'ann-1',
        tenantId,
        authorId,
        title: 'Draft',
        content: 'x',
        priority: 'NORMAL',
        isPublished: false,
        publishedAt: null,
        author: { firstName: 'Jane', lastName: 'Doe' },
      };
      prisma.announcement.create.mockResolvedValue(mockAnnouncement);

      await service.create(tenantId, authorId, { title: 'Draft', content: 'x' });

      expect(feed.refresh).not.toHaveBeenCalled();
      expect(feed.removeBySource).toHaveBeenCalledWith(tenantId, 'Announcement', 'ann-1');
    });

    it('posts a feed item on update when isPublished flips false -> true', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'ann-1',
        tenantId,
        title: 'Draft',
        content: 'x',
        priority: 'NORMAL',
        isPublished: false,
        author: { firstName: 'John', lastName: 'Doe' },
      });
      const updated = {
        id: 'ann-1',
        tenantId,
        authorId,
        title: 'Draft',
        content: 'x',
        priority: 'NORMAL',
        isPublished: true,
        publishedAt: new Date('2026-03-15T12:00:00Z'),
      };
      prisma.announcement.update.mockResolvedValue(updated);
      prisma.user.findMany.mockResolvedValue([]);

      await service.update(tenantId, 'ann-1', { isPublished: true });

      expect(feed.refresh).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 'ann-1', dedupeKey: 'announcement:ann-1' }),
      );
    });

    it('removes the feed item on update when isPublished flips true -> false', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'ann-2',
        tenantId,
        title: 'Published',
        content: 'x',
        priority: 'NORMAL',
        isPublished: true,
        author: { firstName: 'Jane', lastName: 'Smith' },
      });
      const updated = {
        id: 'ann-2',
        tenantId,
        authorId,
        title: 'Published',
        content: 'x',
        priority: 'NORMAL',
        isPublished: false,
        publishedAt: null,
      };
      prisma.announcement.update.mockResolvedValue(updated);

      await service.update(tenantId, 'ann-2', { isPublished: false });

      expect(feed.removeBySource).toHaveBeenCalledWith(tenantId, 'Announcement', 'ann-2');
      expect(feed.refresh).not.toHaveBeenCalled();
    });

    it('refreshes the feed item when a published announcement is edited (title, body, expiresAt)', async () => {
      const expiresAt = new Date('2026-04-01T12:00:00Z');
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'ann-2',
        tenantId,
        title: 'Old title',
        content: 'old',
        isPublished: true,
        author: { firstName: 'Jane', lastName: 'Smith' },
      });
      prisma.announcement.update.mockResolvedValue({
        id: 'ann-2',
        tenantId,
        authorId,
        title: 'New title',
        content: 'updated content',
        priority: 'HIGH',
        isPublished: true,
        publishedAt: new Date('2026-03-15T12:00:00Z'),
        expiresAt,
      });

      await service.update(tenantId, 'ann-2', { title: 'New title', content: 'updated content' });

      expect(feed.refresh).toHaveBeenCalledTimes(1);
      expect(feed.refresh).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          sourceId: 'ann-2',
          dedupeKey: 'announcement:ann-2',
          title: 'New title',
          body: 'updated content',
          payload: { priority: 'HIGH' },
          expiresAt,
        }),
      );
      expect(feed.post).not.toHaveBeenCalled();
      expect(feed.removeBySource).not.toHaveBeenCalled();
    });

    it('passes a null expiresAt through to the feed item', async () => {
      prisma.announcement.create.mockResolvedValue({
        id: 'ann-3',
        tenantId,
        authorId,
        title: 'T',
        content: 'c',
        priority: 'NORMAL',
        isPublished: true,
        publishedAt: new Date('2026-03-15T12:00:00Z'),
        expiresAt: null,
        author: { firstName: 'Jane', lastName: 'Doe' },
      });
      prisma.user.findMany.mockResolvedValue([]);

      await service.create(tenantId, authorId, { title: 'T', content: 'c', isPublished: true });

      expect(feed.refresh).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: null }));
    });

    it('does not touch the feed when an unpublished draft is edited', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'ann-4',
        tenantId,
        title: 'Draft',
        content: 'x',
        isPublished: false,
        author: { firstName: 'Jane', lastName: 'Smith' },
      });
      prisma.announcement.update.mockResolvedValue({
        id: 'ann-4',
        tenantId,
        content: 'updated content',
        isPublished: false,
      });

      await service.update(tenantId, 'ann-4', { content: 'updated content' });

      expect(feed.refresh).not.toHaveBeenCalled();
      expect(feed.post).not.toHaveBeenCalled();
      expect(feed.removeBySource).not.toHaveBeenCalled();
    });

    it('does not fail update when feed.refresh rejects', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'ann-2',
        tenantId,
        title: 'T',
        content: 'x',
        isPublished: true,
        author: { firstName: 'Jane', lastName: 'Smith' },
      });
      prisma.announcement.update.mockResolvedValue({
        id: 'ann-2',
        tenantId,
        authorId,
        title: 'T2',
        content: 'y',
        priority: 'NORMAL',
        isPublished: true,
        publishedAt: new Date(),
        expiresAt: null,
      });
      feed.refresh.mockRejectedValue(new Error('feed is down'));

      await expect(service.update(tenantId, 'ann-2', { title: 'T2' })).resolves.toEqual(
        expect.objectContaining({ id: 'ann-2' }),
      );
    });

    it('removes the feed item on delete', async () => {
      prisma.announcement.findFirst.mockResolvedValue({
        id: 'ann-1',
        tenantId,
        title: 'Test',
        author: { firstName: 'John', lastName: 'Doe' },
      });
      prisma.announcement.delete.mockResolvedValue({});

      await service.delete(tenantId, 'ann-1');

      expect(feed.removeBySource).toHaveBeenCalledWith(tenantId, 'Announcement', 'ann-1');
    });

    it('does not fail create when feed.post rejects', async () => {
      const mockAnnouncement = {
        id: 'ann-1',
        tenantId,
        authorId,
        title: 'Holiday Notice',
        content: 'x',
        priority: 'NORMAL',
        isPublished: true,
        publishedAt: new Date('2026-03-15T12:00:00Z'),
        author: { firstName: 'Jane', lastName: 'Doe' },
      };
      prisma.announcement.create.mockResolvedValue(mockAnnouncement);
      prisma.user.findMany.mockResolvedValue([]);
      feed.post.mockRejectedValue(new Error('feed is down'));

      const result = await service.create(tenantId, authorId, {
        title: 'Holiday Notice',
        content: 'x',
        isPublished: true,
      });

      expect(result).toEqual(mockAnnouncement);
    });
  });
});
