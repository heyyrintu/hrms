import { Logger } from '@nestjs/common';
import { NotificationType, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Consecutive failed cron releases before HR is told. */
export const RELEASE_FAILURE_ALERT_THRESHOLD = 3;

export interface ReleaseFailureAlert {
  tenantId: string;
  title: string;
  message: string;
  link: string;
}

/**
 * Turns silent, repeating cron release failures into one alert. Keeps an
 * in-memory count of consecutive failures per item key (`survey:<id>`,
 * `poll:<id>`); when a count reaches exactly the threshold, every active
 * HR_ADMIN and SUPER_ADMIN of the tenant is notified once. The count resets on
 * success, so a stuck item alerts again only after it recovers and fails three
 * more times. The count is per process and is lost on restart, which at worst
 * delays an alert by a few cron runs.
 *
 * Nothing here logs or stores an employee identifier.
 */
export class ReleaseFailureAlerter {
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly logger: Logger,
  ) {}

  recordSuccess(key: string): void {
    this.failures.set(key, 0);
  }

  /** Forgets items that were not part of the latest sweep (released elsewhere, deleted). */
  retainOnly(keys: Set<string>): void {
    for (const key of Array.from(this.failures.keys())) {
      if (!keys.has(key)) this.failures.delete(key);
    }
  }

  async recordFailure(key: string, alert: ReleaseFailureAlert): Promise<void> {
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    if (count !== RELEASE_FAILURE_ALERT_THRESHOLD) return;

    try {
      const admins = await this.prisma.user.findMany({
        where: {
          tenantId: alert.tenantId,
          role: { in: [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN] },
          isActive: true,
        },
        select: { id: true },
      });
      if (admins.length === 0) return;
      await this.notifications.createMany(
        admins.map((admin) => ({
          tenantId: alert.tenantId,
          userId: admin.id,
          type: NotificationType.ENGAGEMENT_RELEASE_FAILED,
          title: alert.title,
          message: alert.message,
          link: alert.link,
        })),
      );
    } catch (error) {
      this.logger.error(
        `Failed to send the release-failure alert for ${key}: ${(error as Error).message}`,
      );
    }
  }
}
