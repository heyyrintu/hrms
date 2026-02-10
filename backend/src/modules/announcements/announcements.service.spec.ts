import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, createMockNotificationsService } from '../../test/helpers';
import { NotificationType } from '@prisma/client';

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let prisma: any;
  let notificationsService: any;

  const tenantId = 'tenant-1';
  const authorId = 'emp-author';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
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
});
