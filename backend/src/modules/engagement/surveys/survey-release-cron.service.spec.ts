import { Test, TestingModule } from '@nestjs/testing';
import { SurveyStatus } from '@prisma/client';
import { SurveyReleaseCronService } from './survey-release-cron.service';
import { SurveyReleaseService } from './survey-release.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('SurveyReleaseCronService', () => {
  let cron: SurveyReleaseCronService;
  let prisma: any;
  let release: { release: jest.Mock };

  const now = new Date('2026-09-28T12:00:00Z');

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(now);
    prisma = createMockPrismaService();
    release = { release: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SurveyReleaseCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: SurveyReleaseService, useValue: release },
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
      select: { id: true, tenantId: true, status: true, closesAt: true },
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
});
