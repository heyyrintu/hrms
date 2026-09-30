import { Test, TestingModule } from '@nestjs/testing';
import { PollStatus } from '@prisma/client';
import { PollReleaseCronService } from './poll-release-cron.service';
import { PollReleaseService } from './poll-release.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { createMockNotificationsService, createMockPrismaService } from '../../../test/helpers';

describe('PollReleaseCronService', () => {
  let cron: PollReleaseCronService;
  let prisma: any;
  let release: { release: jest.Mock };
  let notifications: ReturnType<typeof createMockNotificationsService>;

  const now = new Date('2026-09-28T12:00:00Z');

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(now);
    prisma = createMockPrismaService();
    release = { release: jest.fn().mockResolvedValue(0) };
    notifications = createMockNotificationsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollReleaseCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: PollReleaseService, useValue: release },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    cron = module.get(PollReleaseCronService);
  });

  afterEach(() => jest.useRealTimers());

  it('only looks at polls that have pending votes', async () => {
    prisma.poll.findMany.mockResolvedValue([]);

    await cron.handleRelease();

    expect(prisma.poll.findMany).toHaveBeenCalledWith({
      where: { pending: { some: {} } },
      select: { id: true, tenantId: true, question: true, status: true, closesAt: true },
    });
  });

  it('force-applies CLOSED or expired polls and non-force applies open ones', async () => {
    prisma.poll.findMany.mockResolvedValue([
      { id: 'p-closed', tenantId: 't1', status: PollStatus.CLOSED, closesAt: null },
      {
        id: 'p-expired',
        tenantId: 't1',
        status: PollStatus.ACTIVE,
        closesAt: new Date('2026-09-28T11:59:00Z'),
      },
      { id: 'p-open', tenantId: 't2', status: PollStatus.ACTIVE, closesAt: null },
    ]);

    await cron.handleRelease();

    expect(release.release).toHaveBeenCalledWith('t1', 'p-closed', { force: true });
    expect(release.release).toHaveBeenCalledWith('t1', 'p-expired', { force: true });
    expect(release.release).toHaveBeenCalledWith('t2', 'p-open', { force: false });
  });

  it('isolates a failing poll and carries on with the rest', async () => {
    prisma.poll.findMany.mockResolvedValue([
      { id: 'p-1', tenantId: 't1', status: PollStatus.CLOSED, closesAt: null },
      { id: 'p-2', tenantId: 't1', status: PollStatus.CLOSED, closesAt: null },
    ]);
    release.release.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(1);

    await expect(cron.handleRelease()).resolves.toBeUndefined();

    expect(release.release).toHaveBeenCalledTimes(2);
    expect(release.release).toHaveBeenLastCalledWith('t1', 'p-2', { force: true });
  });

  it('does not throw when the poll lookup fails', async () => {
    prisma.poll.findMany.mockRejectedValue(new Error('db down'));

    await expect(cron.handleRelease()).resolves.toBeUndefined();
  });

  describe('release-failure alert', () => {
    const stuck = {
      id: 'p-stuck',
      tenantId: 't1',
      question: 'Best snack?',
      status: PollStatus.CLOSED,
      closesAt: null,
    };

    beforeEach(() => {
      prisma.poll.findMany.mockResolvedValue([stuck]);
      prisma.user.findMany.mockResolvedValue([{ id: 'u-hr' }, { id: 'u-super' }]);
      release.release.mockRejectedValue(new Error('no key'));
    });

    it('does not notify after two failed sweeps', async () => {
      await cron.handleRelease();
      await cron.handleRelease();

      expect(notifications.createMany).not.toHaveBeenCalled();
    });

    it('notifies active HR and super admins once on the third failed sweep, not the fourth', async () => {
      for (let i = 0; i < 3; i++) await cron.handleRelease();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', role: { in: ['HR_ADMIN', 'SUPER_ADMIN'] }, isActive: true },
        select: { id: true },
      });
      expect(notifications.createMany).toHaveBeenCalledTimes(1);
      const sent = notifications.createMany.mock.calls[0][0];
      expect(sent.map((n: any) => n.userId)).toEqual(['u-hr', 'u-super']);
      expect(sent[0]).toEqual(
        expect.objectContaining({
          tenantId: 't1',
          type: 'ENGAGEMENT_RELEASE_FAILED',
          title: 'Poll results are stuck',
          link: '/engagement/polls',
        }),
      );
      expect(sent[0].message).toContain('Best snack?');
      expect(sent[0].message).toContain('FIELD_ENCRYPTION_KEY');

      await cron.handleRelease();
      expect(notifications.createMany).toHaveBeenCalledTimes(1);
    });

    it('a successful release resets the count', async () => {
      await cron.handleRelease();
      await cron.handleRelease();
      release.release.mockResolvedValueOnce(1);
      await cron.handleRelease();
      release.release.mockRejectedValue(new Error('no key'));
      await cron.handleRelease();
      await cron.handleRelease();

      expect(notifications.createMany).not.toHaveBeenCalled();
    });

    it('does not let a notification error break the sweep', async () => {
      notifications.createMany.mockRejectedValue(new Error('notify down'));

      for (let i = 0; i < 3; i++) await expect(cron.handleRelease()).resolves.toBeUndefined();
    });
  });
});
