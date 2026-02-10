import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService, CreateNotificationInput } from './notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { NotificationType } from '@prisma/client';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;

  const tenantId = 'tenant-1';
  const userId = 'user-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // create
  // ============================================

  describe('create', () => {
    it('should create a notification', async () => {
      const input: CreateNotificationInput = {
        tenantId,
        userId,
        type: NotificationType.LEAVE_APPROVED,
        title: 'Leave Approved',
        message: 'Your leave request was approved',
        link: '/leaves',
        metadata: { leaveId: 'lr-1' },
      };
      const mockCreated = { id: 'notif-1', ...input, isRead: false };
      prisma.notification.create.mockResolvedValue(mockCreated);

      const result = await service.create(input);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          userId,
          type: NotificationType.LEAVE_APPROVED,
          title: 'Leave Approved',
          message: 'Your leave request was approved',
          link: '/leaves',
          metadata: { leaveId: 'lr-1' } as any,
        },
      });
      expect(result).toEqual(mockCreated);
    });

    it('should create a notification without optional fields', async () => {
      const input: CreateNotificationInput = {
        tenantId,
        userId,
        type: NotificationType.GENERAL,
        title: 'Welcome',
        message: 'Welcome to the platform',
      };
      const mockCreated = { id: 'notif-2', ...input, isRead: false };
      prisma.notification.create.mockResolvedValue(mockCreated);

      const result = await service.create(input);

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          userId,
          type: NotificationType.GENERAL,
          title: 'Welcome',
          message: 'Welcome to the platform',
          link: undefined,
          metadata: undefined,
        },
      });
      expect(result).toEqual(mockCreated);
    });
  });

  // ============================================
  // createMany
  // ============================================

  describe('createMany', () => {
    it('should create multiple notifications', async () => {
      const inputs: CreateNotificationInput[] = [
        {
          tenantId,
          userId: 'user-1',
          type: NotificationType.ANNOUNCEMENT,
          title: 'New Announcement',
          message: 'Check the dashboard',
          link: '/dashboard',
        },
        {
          tenantId,
          userId: 'user-2',
          type: NotificationType.ANNOUNCEMENT,
          title: 'New Announcement',
          message: 'Check the dashboard',
          link: '/dashboard',
        },
      ];
      prisma.notification.createMany.mockResolvedValue({ count: 2 });

      const result = await service.createMany(inputs);

      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: inputs.map((input) => ({
          tenantId: input.tenantId,
          userId: input.userId,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link,
          metadata: undefined,
        })),
      });
      expect(result).toEqual({ count: 2 });
    });

    it('should handle empty array', async () => {
      prisma.notification.createMany.mockResolvedValue({ count: 0 });

      const result = await service.createMany([]);

      expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: [] });
      expect(result).toEqual({ count: 0 });
    });
  });

  // ============================================
  // getNotifications
  // ============================================

  describe('getNotifications', () => {
    it('should return paginated notifications with defaults', async () => {
      const mockNotifications = [
        { id: 'n-1', title: 'Test', isRead: false },
      ];
      prisma.notification.findMany.mockResolvedValue(mockNotifications);
      prisma.notification.count.mockResolvedValue(1);

      const result = await service.getNotifications(userId, tenantId, {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId, tenantId },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId, tenantId },
      });
      expect(result).toEqual({
        data: mockNotifications,
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('should paginate with custom page and limit', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(50);

      const result = await service.getNotifications(userId, tenantId, {
        page: 3,
        limit: 10,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
      expect(result.meta).toEqual({
        total: 50,
        page: 3,
        limit: 10,
        totalPages: 5,
      });
    });

    it('should filter unread only when unreadOnly is true', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await service.getNotifications(userId, tenantId, { unreadOnly: true });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, tenantId, isRead: false },
        }),
      );
    });

    it('should not filter by isRead when unreadOnly is not set', async () => {
      prisma.notification.findMany.mockResolvedValue([]);
      prisma.notification.count.mockResolvedValue(0);

      await service.getNotifications(userId, tenantId, {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, tenantId },
        }),
      );
    });
  });

  // ============================================
  // getUnreadCount
  // ============================================

  describe('getUnreadCount', () => {
    it('should return unread notification count', async () => {
      prisma.notification.count.mockResolvedValue(7);

      const result = await service.getUnreadCount(userId, tenantId);

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId, tenantId, isRead: false },
      });
      expect(result).toEqual({ count: 7 });
    });

    it('should return zero when no unread notifications', async () => {
      prisma.notification.count.mockResolvedValue(0);

      const result = await service.getUnreadCount(userId, tenantId);

      expect(result).toEqual({ count: 0 });
    });
  });

  // ============================================
  // markAsRead
  // ============================================

  describe('markAsRead', () => {
    it('should mark a specific notification as read', async () => {
      const mockResult = { count: 1 };
      prisma.notification.updateMany.mockResolvedValue(mockResult);

      const result = await service.markAsRead(userId, tenantId, 'notif-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId, tenantId },
        data: { isRead: true },
      });
      expect(result).toEqual(mockResult);
    });

    it('should return count 0 when notification does not belong to user', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.markAsRead(userId, tenantId, 'wrong-notif');

      expect(result).toEqual({ count: 0 });
    });
  });

  // ============================================
  // markAllAsRead
  // ============================================

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read for user', async () => {
      const mockResult = { count: 5 };
      prisma.notification.updateMany.mockResolvedValue(mockResult);

      const result = await service.markAllAsRead(userId, tenantId);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId, tenantId, isRead: false },
        data: { isRead: true },
      });
      expect(result).toEqual(mockResult);
    });

    it('should return count 0 when no unread notifications exist', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.markAllAsRead(userId, tenantId);

      expect(result).toEqual({ count: 0 });
    });
  });

  // ============================================
  // deleteNotification
  // ============================================

  describe('deleteNotification', () => {
    it('should delete a notification by id for the user', async () => {
      const mockResult = { count: 1 };
      prisma.notification.deleteMany.mockResolvedValue(mockResult);

      const result = await service.deleteNotification(userId, tenantId, 'notif-1');

      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId, tenantId },
      });
      expect(result).toEqual(mockResult);
    });

    it('should return count 0 when notification does not exist or belongs to another user', async () => {
      prisma.notification.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.deleteNotification(userId, tenantId, 'wrong-id');

      expect(result).toEqual({ count: 0 });
    });
  });

  // ============================================
  // getUserIdByEmployeeId
  // ============================================

  describe('getUserIdByEmployeeId', () => {
    it('should return userId when user with employeeId exists', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-42' });

      const result = await service.getUserIdByEmployeeId(tenantId, 'emp-1');

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { tenantId, employeeId: 'emp-1' },
        select: { id: true },
      });
      expect(result).toBe('user-42');
    });

    it('should return null when no user found for employeeId', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.getUserIdByEmployeeId(tenantId, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  // ============================================
  // notifyEmployee
  // ============================================

  describe('notifyEmployee', () => {
    it('should create a notification for the employee user', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-42' });
      const mockNotif = { id: 'notif-1', userId: 'user-42' };
      prisma.notification.create.mockResolvedValue(mockNotif);

      const result = await service.notifyEmployee(
        tenantId,
        'emp-1',
        NotificationType.LEAVE_APPROVED,
        'Leave Approved',
        'Your leave was approved',
        '/leaves',
      );

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { tenantId, employeeId: 'emp-1' },
        select: { id: true },
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          userId: 'user-42',
          type: NotificationType.LEAVE_APPROVED,
          title: 'Leave Approved',
          message: 'Your leave was approved',
          link: '/leaves',
          metadata: undefined,
        },
      });
      expect(result).toEqual(mockNotif);
    });

    it('should return null when no user found for employee', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.notifyEmployee(
        tenantId,
        'nonexistent',
        NotificationType.LEAVE_APPROVED,
        'Leave Approved',
        'Your leave was approved',
      );

      expect(result).toBeNull();
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // notifyByRole
  // ============================================

  describe('notifyByRole', () => {
    it('should notify all active users with given roles', async () => {
      const mockUsers = [{ id: 'user-1' }, { id: 'user-2' }, { id: 'user-3' }];
      prisma.user.findMany.mockResolvedValue(mockUsers);
      prisma.notification.createMany.mockResolvedValue({ count: 3 });

      const result = await service.notifyByRole(
        tenantId,
        ['HR_ADMIN', 'SUPER_ADMIN'],
        NotificationType.LEAVE_APPROVED,
        'New Leave Request',
        'An employee submitted a leave request',
        '/leaves/pending',
      );

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId, role: { in: ['HR_ADMIN', 'SUPER_ADMIN'] as any }, isActive: true },
        select: { id: true },
      });
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: mockUsers.map((u) => ({
          tenantId,
          userId: u.id,
          type: NotificationType.LEAVE_APPROVED,
          title: 'New Leave Request',
          message: 'An employee submitted a leave request',
          link: '/leaves/pending',
        })),
      });
      expect(result).toEqual({ count: 3 });
    });

    it('should do nothing when no users match the roles', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      const result = await service.notifyByRole(
        tenantId,
        ['SUPER_ADMIN'],
        NotificationType.GENERAL,
        'Test',
        'Test message',
      );

      expect(result).toBeUndefined();
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });
  });
});
