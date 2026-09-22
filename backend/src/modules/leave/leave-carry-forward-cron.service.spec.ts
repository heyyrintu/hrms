import { Test, TestingModule } from '@nestjs/testing';
import { AccrualTriggerType } from '@prisma/client';
import { LeaveCarryForwardCronService } from './leave-carry-forward-cron.service';
import { LeaveCarryForwardService } from './leave-carry-forward.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';

/**
 * The cron fires at 03:00 Asia/Kolkata on 1 January, which is 21:30 UTC on the
 * previous 31 December. The year it closes has to be read in Asia/Kolkata: a
 * UTC-hosted box reading the server's own year would close the year before
 * last, `runCarryForward` would answer `alreadyRan`, and the year that just
 * ended would silently never be carried forward.
 */
describe('LeaveCarryForwardCronService', () => {
  let service: LeaveCarryForwardCronService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let carryForward: { runCarryForward: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    carryForward = { runCarryForward: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveCarryForwardCronService,
        { provide: LeaveCarryForwardService, useValue: carryForward },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LeaveCarryForwardCronService>(LeaveCarryForwardCronService);

    prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'Acme' }]);
    carryForward.runCarryForward.mockResolvedValue({
      runId: 'run-1',
      processedCount: 3,
      failedCount: 0,
      alreadyRan: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('closes the year that just ended in Asia/Kolkata, not in the server zone', async () => {
    // 2026-12-31T21:30:00Z === 2027-01-01 03:00 IST, the cron's own instant.
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T21:30:00Z'));

    await service.handleYearEndCarryForward();

    expect(carryForward.runCarryForward).toHaveBeenCalledWith(
      'tenant-1',
      2026,
      AccrualTriggerType.CRON_JOB,
    );
  });

  it('still reads 2026 when the instant is already 1 January in UTC', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2027-01-01T03:00:00Z'));

    await service.handleYearEndCarryForward();

    expect(carryForward.runCarryForward).toHaveBeenCalledWith(
      'tenant-1',
      2026,
      AccrualTriggerType.CRON_JOB,
    );
  });

  it('carries on to the next tenant when one fails', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T21:30:00Z'));
    prisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', name: 'Acme' },
      { id: 'tenant-2', name: 'Globex' },
    ]);
    carryForward.runCarryForward
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ runId: 'run-2', processedCount: 1, failedCount: 0 });

    await expect(service.handleYearEndCarryForward()).resolves.toBeUndefined();

    expect(carryForward.runCarryForward).toHaveBeenCalledTimes(2);
    expect(carryForward.runCarryForward).toHaveBeenLastCalledWith(
      'tenant-2',
      2026,
      AccrualTriggerType.CRON_JOB,
    );
  });
});
