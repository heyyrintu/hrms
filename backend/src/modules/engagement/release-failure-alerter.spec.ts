import { Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { ReleaseFailureAlerter } from './release-failure-alerter';
import { createMockPrismaService, createMockNotificationsService } from '../../test/helpers';

describe('ReleaseFailureAlerter', () => {
  let prisma: any;
  let notifications: ReturnType<typeof createMockNotificationsService>;
  let logger: { error: jest.Mock };
  let alerter: ReleaseFailureAlerter;

  const alert = {
    tenantId: 't1',
    title: 'Survey results are stuck',
    message: 'msg',
    link: '/engagement/surveys/s-1/results',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    notifications = createMockNotificationsService();
    logger = { error: jest.fn() };
    prisma.user.findMany.mockResolvedValue([{ id: 'u-hr' }, { id: 'u-super' }]);
    alerter = new ReleaseFailureAlerter(prisma, notifications as any, logger as unknown as Logger);
  });

  it('does not notify after one or two consecutive failures', async () => {
    await alerter.recordFailure('survey:s-1', alert);
    await alerter.recordFailure('survey:s-1', alert);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('notifies active HR_ADMIN and SUPER_ADMIN users of the tenant on the third failure', async () => {
    for (let i = 0; i < 3; i++) await alerter.recordFailure('survey:s-1', alert);

    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', role: { in: ['HR_ADMIN', 'SUPER_ADMIN'] }, isActive: true },
      select: { id: true },
    });
    expect(notifications.createMany).toHaveBeenCalledTimes(1);
    expect(notifications.createMany).toHaveBeenCalledWith([
      {
        tenantId: 't1',
        userId: 'u-hr',
        type: NotificationType.ENGAGEMENT_RELEASE_FAILED,
        title: 'Survey results are stuck',
        message: 'msg',
        link: '/engagement/surveys/s-1/results',
      },
      {
        tenantId: 't1',
        userId: 'u-super',
        type: NotificationType.ENGAGEMENT_RELEASE_FAILED,
        title: 'Survey results are stuck',
        message: 'msg',
        link: '/engagement/surveys/s-1/results',
      },
    ]);
  });

  it('does not notify again on the fourth and later failures', async () => {
    for (let i = 0; i < 6; i++) await alerter.recordFailure('survey:s-1', alert);

    expect(notifications.createMany).toHaveBeenCalledTimes(1);
  });

  it('resets on success: three more failures are needed to alert again', async () => {
    for (let i = 0; i < 3; i++) await alerter.recordFailure('survey:s-1', alert);
    alerter.recordSuccess('survey:s-1');
    await alerter.recordFailure('survey:s-1', alert);
    await alerter.recordFailure('survey:s-1', alert);
    expect(notifications.createMany).toHaveBeenCalledTimes(1);

    await alerter.recordFailure('survey:s-1', alert);
    expect(notifications.createMany).toHaveBeenCalledTimes(2);
  });

  it('a success between failures breaks the streak', async () => {
    await alerter.recordFailure('poll:p-1', alert);
    await alerter.recordFailure('poll:p-1', alert);
    alerter.recordSuccess('poll:p-1');
    await alerter.recordFailure('poll:p-1', alert);

    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('counts each item separately', async () => {
    await alerter.recordFailure('survey:s-1', alert);
    await alerter.recordFailure('survey:s-2', alert);
    await alerter.recordFailure('survey:s-1', alert);
    await alerter.recordFailure('survey:s-2', alert);

    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('retainOnly forgets items missing from the latest sweep', async () => {
    await alerter.recordFailure('survey:s-1', alert);
    await alerter.recordFailure('survey:s-1', alert);
    alerter.retainOnly(new Set(['survey:s-2']));
    await alerter.recordFailure('survey:s-1', alert);

    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('sends nothing when the tenant has no active HR or super admins', async () => {
    prisma.user.findMany.mockResolvedValue([]);

    for (let i = 0; i < 3; i++) await alerter.recordFailure('survey:s-1', alert);

    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('catches and logs a notification error without throwing', async () => {
    notifications.createMany.mockRejectedValue(new Error('notify down'));

    for (let i = 0; i < 3; i++) {
      await expect(alerter.recordFailure('survey:s-1', alert)).resolves.toBeUndefined();
    }

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('notify down'));
  });
});
