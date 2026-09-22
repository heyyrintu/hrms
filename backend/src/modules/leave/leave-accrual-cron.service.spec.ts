import { Test, TestingModule } from '@nestjs/testing';
import { AccrualTriggerType } from '@prisma/client';
import { LeaveAccrualCronService } from './leave-accrual-cron.service';
import { LeaveAccrualService } from './leave-accrual.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';

/**
 * The cron fires at 02:00 Asia/Kolkata on the 1st, which is 20:30 UTC on the
 * last day of the previous month. The month it accrues has to be read in
 * Asia/Kolkata: a UTC-hosted box reading the server's own month would accrue
 * the month that just ended a second time and never accrue the new one.
 */
describe('LeaveAccrualCronService', () => {
  let service: LeaveAccrualCronService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;
  let accrual: { triggerAccrual: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    accrual = { triggerAccrual: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveAccrualCronService,
        { provide: LeaveAccrualService, useValue: accrual },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LeaveAccrualCronService>(LeaveAccrualCronService);

    prisma.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'Acme' }]);
    accrual.triggerAccrual.mockResolvedValue({ processedCount: 4, failedCount: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accrues the month the cron fires in, read in Asia/Kolkata', async () => {
    // 2026-02-28T20:30:00Z === 2026-03-01 02:00 IST, the cron's own instant.
    jest.useFakeTimers().setSystemTime(new Date('2026-02-28T20:30:00Z'));

    await service.handleMonthlyAccrual();

    expect(accrual.triggerAccrual).toHaveBeenCalledWith(
      'tenant-1',
      { month: 3, year: 2026 },
      AccrualTriggerType.CRON_JOB,
    );
  });

  it('rolls the year over with the month', async () => {
    // 2026-12-31T20:30:00Z === 2027-01-01 02:00 IST.
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T20:30:00Z'));

    await service.handleMonthlyAccrual();

    expect(accrual.triggerAccrual).toHaveBeenCalledWith(
      'tenant-1',
      { month: 1, year: 2027 },
      AccrualTriggerType.CRON_JOB,
    );
  });

  it('carries on to the next tenant when one fails', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-02-28T20:30:00Z'));
    prisma.tenant.findMany.mockResolvedValue([
      { id: 'tenant-1', name: 'Acme' },
      { id: 'tenant-2', name: 'Globex' },
    ]);
    accrual.triggerAccrual
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ processedCount: 1, failedCount: 0 });

    await expect(service.handleMonthlyAccrual()).resolves.toBeUndefined();

    expect(accrual.triggerAccrual).toHaveBeenCalledTimes(2);
    expect(accrual.triggerAccrual).toHaveBeenLastCalledWith(
      'tenant-2',
      { month: 3, year: 2026 },
      AccrualTriggerType.CRON_JOB,
    );
  });
});
