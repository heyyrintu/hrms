import { Test, TestingModule } from '@nestjs/testing';
import { SurveyStatus } from '@prisma/client';
import { SurveyReleaseCronService } from './survey-release-cron.service';
import { SurveyReleaseService } from './survey-release.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { createMockNotificationsService, createMockPrismaService } from '../../../test/helpers';

describe('SurveyReleaseCronService', () => {
  let cron: SurveyReleaseCronService;
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
        SurveyReleaseCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: SurveyReleaseService, useValue: release },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    cron = module.get(SurveyReleaseCronService);
  });

  afterEach(() => jest.useRealTimers());

  it('only looks at surveys that have pending responses', async () => {
    prisma.survey.findMany.mockResolvedValue([]);

    await cron.handleRelease();

    expect(prisma.survey.findMany).toHaveBeenCalledWith({
      where: { pending: { some: {} } },
      select: { id: true, tenantId: true, title: true, status: true, closesAt: true },
    });
  });

  it('force-releases CLOSED or past-closesAt surveys and non-force releases open ones', async () => {
    prisma.survey.findMany.mockResolvedValue([
      { id: 's-closed', tenantId: 't1', status: SurveyStatus.CLOSED, closesAt: null },
      {
        id: 's-expired',
        tenantId: 't1',
        status: SurveyStatus.ACTIVE,
        closesAt: new Date('2026-09-28T11:00:00Z'),
      },
      {
        id: 's-open',
        tenantId: 't2',
        status: SurveyStatus.ACTIVE,
        closesAt: new Date('2026-09-30T00:00:00Z'),
      },
      { id: 's-no-close', tenantId: 't2', status: SurveyStatus.ACTIVE, closesAt: null },
    ]);

    await cron.handleRelease();

    expect(release.release).toHaveBeenCalledWith('t1', 's-closed', { force: true });
    expect(release.release).toHaveBeenCalledWith('t1', 's-expired', { force: true });
    expect(release.release).toHaveBeenCalledWith('t2', 's-open', { force: false });
    expect(release.release).toHaveBeenCalledWith('t2', 's-no-close', { force: false });
  });

  it('isolates a failing survey and carries on with the rest', async () => {
    prisma.survey.findMany.mockResolvedValue([
      { id: 's-1', tenantId: 't1', status: SurveyStatus.CLOSED, closesAt: null },
      { id: 's-2', tenantId: 't1', status: SurveyStatus.CLOSED, closesAt: null },
    ]);
    release.release.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(1);

    await expect(cron.handleRelease()).resolves.toBeUndefined();

    expect(release.release).toHaveBeenCalledTimes(2);
    expect(release.release).toHaveBeenLastCalledWith('t1', 's-2', { force: true });
  });

  it('does not throw when the survey lookup fails', async () => {
    prisma.survey.findMany.mockRejectedValue(new Error('db down'));

    await expect(cron.handleRelease()).resolves.toBeUndefined();
  });

  describe('release-failure alert', () => {
    const stuck = {
      id: 's-stuck',
      tenantId: 't1',
      title: 'Q3 pulse',
      status: SurveyStatus.CLOSED,
      closesAt: null,
    };

    beforeEach(() => {
      prisma.survey.findMany.mockResolvedValue([stuck]);
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
          title: 'Survey results are stuck',
          link: '/engagement/surveys/s-stuck/results',
        }),
      );
      expect(sent[0].message).toContain('Q3 pulse');
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
