import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  markAllAsRead: jest.fn(),
  markAsRead: jest.fn(),
  deleteNotification: jest.fn(),
};

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: typeof mockService;

  const mockUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'user@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: mockService }],
    }).compile();
    controller = module.get<NotificationsController>(NotificationsController);
    service = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // getNotifications
  // ============================================
  describe('getNotifications', () => {
    it('should return notifications with query params', async () => {
      const expected = { data: [{ id: 'n-1' }], total: 1 };
      service.getNotifications.mockResolvedValue(expected);
      const query = { page: 1, limit: 20, unreadOnly: true };

      const result = await controller.getNotifications(mockUser, query);

      expect(result).toEqual(expected);
      expect(service.getNotifications).toHaveBeenCalledWith(
        mockUser.userId,
        mockUser.tenantId,
        query,
      );
    });

    it('should pass default query when no filters specified', async () => {
      service.getNotifications.mockResolvedValue({ data: [], total: 0 });

      await controller.getNotifications(mockUser, {});

      expect(service.getNotifications).toHaveBeenCalledWith(
        mockUser.userId,
        mockUser.tenantId,
        {},
      );
    });
  });

  // ============================================
  // getUnreadCount
  // ============================================
  describe('getUnreadCount', () => {
    it('should return unread notification count', async () => {
      const expected = { count: 5 };
      service.getUnreadCount.mockResolvedValue(expected);

      const result = await controller.getUnreadCount(mockUser);

      expect(result).toEqual(expected);
      expect(service.getUnreadCount).toHaveBeenCalledWith(
        mockUser.userId,
        mockUser.tenantId,
      );
    });
  });

  // ============================================
  // markAllAsRead
  // ============================================
  describe('markAllAsRead', () => {
    it('should mark all notifications as read and return message', async () => {
      service.markAllAsRead.mockResolvedValue(undefined);

      const result = await controller.markAllAsRead(mockUser);

      expect(result).toEqual({ message: 'All notifications marked as read' });
      expect(service.markAllAsRead).toHaveBeenCalledWith(
        mockUser.userId,
        mockUser.tenantId,
      );
    });
  });

  // ============================================
  // markAsRead
  // ============================================
  describe('markAsRead', () => {
    it('should mark a single notification as read', async () => {
      service.markAsRead.mockResolvedValue(undefined);

      const result = await controller.markAsRead(mockUser, 'notif-1');

      expect(result).toEqual({ message: 'Notification marked as read' });
      expect(service.markAsRead).toHaveBeenCalledWith(
        mockUser.userId,
        mockUser.tenantId,
        'notif-1',
      );
    });
  });

  // ============================================
  // deleteNotification
  // ============================================
  describe('deleteNotification', () => {
    it('should delete a notification and return message', async () => {
      service.deleteNotification.mockResolvedValue(undefined);

      const result = await controller.deleteNotification(mockUser, 'notif-1');

      expect(result).toEqual({ message: 'Notification deleted' });
      expect(service.deleteNotification).toHaveBeenCalledWith(
        mockUser.userId,
        mockUser.tenantId,
        'notif-1',
      );
    });
  });
});
