import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { NotificationQueryDto } from './dto/notification.dto';

export interface CreateNotificationInput {
  tenantId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(input: CreateNotificationInput) {
    return this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link,
        metadata: input.metadata as any,
      },
    });
  }

  async createMany(inputs: CreateNotificationInput[]) {
    return this.prisma.notification.createMany({
      data: inputs.map((input) => ({
        tenantId: input.tenantId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message,
        link: input.link,
        metadata: input.metadata as any,
      })),
    });
  }

  async getNotifications(userId: string, tenantId: string, query: NotificationQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { userId, tenantId };
    if (query.unreadOnly) {
      where.isRead = false;
    }

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
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

  async getUnreadCount(userId: string, tenantId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, tenantId, isRead: false },
    });
    return { count };
  }

  async markAsRead(userId: string, tenantId: string, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId, tenantId },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string, tenantId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, tenantId, isRead: false },
      data: { isRead: true },
    });
  }

  async deleteNotification(userId: string, tenantId: string, notificationId: string) {
    return this.prisma.notification.deleteMany({
      where: { id: notificationId, userId, tenantId },
    });
  }

  // Helper to find userId from employeeId
  async getUserIdByEmployeeId(tenantId: string, employeeId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, employeeId },
      select: { id: true },
    });
    return user?.id || null;
  }

  // Notify a specific employee
  async notifyEmployee(
    tenantId: string,
    employeeId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
  ) {
    const userId = await this.getUserIdByEmployeeId(tenantId, employeeId);
    if (!userId) return null;

    return this.create({
      tenantId,
      userId,
      type,
      title,
      message,
      link,
    });
  }

  // Notify all users with a specific role in a tenant
  async notifyByRole(
    tenantId: string,
    roles: string[],
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
  ) {
    const users = await this.prisma.user.findMany({
      where: { tenantId, role: { in: roles as any }, isActive: true },
      select: { id: true },
    });

    if (users.length === 0) return;

    return this.createMany(
      users.map((u) => ({
        tenantId,
        userId: u.id,
        type,
        title,
        message,
        link,
      })),
    );
  }
}
