export function createMockNotificationsService() {
  return {
    create: jest.fn().mockResolvedValue(undefined),
    createMany: jest.fn().mockResolvedValue(undefined),
    getNotifications: jest.fn().mockResolvedValue({ data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } }),
    getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
    markAsRead: jest.fn().mockResolvedValue(undefined),
    markAllAsRead: jest.fn().mockResolvedValue(undefined),
    deleteNotification: jest.fn().mockResolvedValue(undefined),
    getUserIdByEmployeeId: jest.fn().mockResolvedValue('mock-user-id'),
    notifyEmployee: jest.fn().mockResolvedValue(undefined),
    notifyByRole: jest.fn().mockResolvedValue(undefined),
  };
}
