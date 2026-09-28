import { Test, TestingModule } from '@nestjs/testing';
import { PollStatus } from '@prisma/client';
import { PollReleaseCronService } from './poll-release-cron.service';
import { PollReleaseService } from './poll-release.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('PollReleaseCronService', () => {
  let cron: PollReleaseCronService;
  let prisma: any;
  let release: { release: jest.Mock };

  const now = new Date('2026-09-28T12:00:00Z');

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(now);
    prisma = createMockPrismaService();
    release = { release: jest.fn().mockResolvedValue(0) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollReleaseCronService,
        { provide: PrismaService, useValue: prisma },
        { provide: PollReleaseService, useValue: release },
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
      select: { id: true, tenantId: true, status: true, closesAt: true },
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
});
