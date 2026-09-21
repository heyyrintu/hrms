import { Test, TestingModule } from '@nestjs/testing';
import { AutoAbsentCronService } from './auto-absent-cron.service';
import { AutoAbsentService } from './auto-absent.service';

/**
 * The sweep fires at 23:30 Asia/Kolkata, which is 18:00 UTC the same day. The
 * day it closes has to be the Asia/Kolkata calendar day, expressed as UTC
 * midnight, because that is the shape Prisma stores for `AttendanceRecord.date`.
 */
describe('AutoAbsentCronService', () => {
  let service: AutoAbsentCronService;
  let autoAbsent: { runForAllTenants: jest.Mock };

  beforeEach(async () => {
    autoAbsent = { runForAllTenants: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutoAbsentCronService,
        { provide: AutoAbsentService, useValue: autoAbsent },
      ],
    }).compile();

    service = module.get<AutoAbsentCronService>(AutoAbsentCronService);
    autoAbsent.runForAllTenants.mockResolvedValue({
      tenants: 2,
      marked: 5,
      skipped: 1,
      failed: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sweeps the Asia/Kolkata calendar day as UTC midnight', async () => {
    // 2026-12-31T18:00:00Z === 2026-12-31 23:30 IST, the cron's own instant.
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T18:00:00Z'));

    await service.handleNightlyAutoAbsent();

    expect(autoAbsent.runForAllTenants).toHaveBeenCalledWith(
      new Date('2026-12-31T00:00:00.000Z'),
    );
  });

  it('uses the IST day even when UTC has not rolled over yet', async () => {
    // 21:30 UTC on 15 March is already 03:00 IST on 16 March.
    jest.useFakeTimers().setSystemTime(new Date('2026-03-15T21:30:00Z'));

    await service.handleNightlyAutoAbsent();

    expect(autoAbsent.runForAllTenants).toHaveBeenCalledWith(
      new Date('2026-03-16T00:00:00.000Z'),
    );
  });

  it('swallows a sweep failure so the scheduler is not left with a rejection', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31T18:00:00Z'));
    autoAbsent.runForAllTenants.mockRejectedValue(new Error('boom'));

    await expect(service.handleNightlyAutoAbsent()).resolves.toBeUndefined();
  });
});
