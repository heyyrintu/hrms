import { Test, TestingModule } from '@nestjs/testing';
import { OtCalculationService } from './ot-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';

describe('OtCalculationService', () => {
  let service: OtCalculationService;
  let prisma: any;

  const tenantId = 'test-tenant';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OtCalculationService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<OtCalculationService>(OtCalculationService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -----------------------------------------------------------
  // getOtRule
  // -----------------------------------------------------------
  describe('getOtRule', () => {
    it('should return a rule matching the employment type', async () => {
      const specificRule = {
        id: 'rule-1',
        tenantId,
        employmentType: 'FULL_TIME',
        isActive: true,
        dailyThresholdMinutes: 480,
        roundingIntervalMinutes: 15,
        maxOtPerDayMinutes: 240,
        maxOtPerMonthMinutes: 4800,
      };

      prisma.otRule.findFirst.mockResolvedValue(specificRule);

      const result = await service.getOtRule(tenantId, 'FULL_TIME' as any);

      expect(prisma.otRule.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          employmentType: 'FULL_TIME',
          isActive: true,
        },
      });
      expect(result).toEqual(specificRule);
    });

    it('should fall back to default rule (null employmentType) when no specific rule found', async () => {
      const defaultRule = {
        id: 'rule-default',
        tenantId,
        employmentType: null,
        isActive: true,
        dailyThresholdMinutes: 480,
      };

      // First call (specific type) returns null, second call (default) returns the rule
      prisma.otRule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(defaultRule);

      const result = await service.getOtRule(tenantId, 'PART_TIME' as any);

      expect(prisma.otRule.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.otRule.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          tenantId,
          employmentType: 'PART_TIME',
          isActive: true,
        },
      });
      expect(prisma.otRule.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          tenantId,
          employmentType: null,
          isActive: true,
        },
      });
      expect(result).toEqual(defaultRule);
    });

    it('should return null when no rules exist at all', async () => {
      prisma.otRule.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getOtRule(tenantId, 'CONTRACT' as any);

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------
  // calculateOtMinutes
  // -----------------------------------------------------------
  describe('calculateOtMinutes', () => {
    it('should use default calculation (worked - standard) when no rule provided', () => {
      const result = service.calculateOtMinutes(540, 480, null);
      expect(result).toBe(60);
    });

    it('should return 0 when worked less than standard and no rule', () => {
      const result = service.calculateOtMinutes(400, 480, null);
      expect(result).toBe(0);
    });

    it('should return 0 when worked equals standard and no rule', () => {
      const result = service.calculateOtMinutes(480, 480, null);
      expect(result).toBe(0);
    });

    it('should use rule dailyThresholdMinutes instead of standardWorkMinutes', () => {
      const rule = {
        dailyThresholdMinutes: 500,
        roundingIntervalMinutes: null,
        maxOtPerDayMinutes: null,
      } as any;

      const result = service.calculateOtMinutes(540, 480, rule);
      // OT = 540 - 500 = 40
      expect(result).toBe(40);
    });

    it('should fall back to standardWorkMinutes when rule has no threshold', () => {
      const rule = {
        dailyThresholdMinutes: null,
        roundingIntervalMinutes: null,
        maxOtPerDayMinutes: null,
      } as any;

      const result = service.calculateOtMinutes(540, 480, rule);
      // OT = 540 - 480 = 60
      expect(result).toBe(60);
    });

    it('should apply rounding to OT minutes', () => {
      const rule = {
        dailyThresholdMinutes: 480,
        roundingIntervalMinutes: 15,
        maxOtPerDayMinutes: null,
      } as any;

      // 487 minutes worked => 7 minutes OT raw
      // roundMinutes(7, 15): 7 < 7.5 => rounds down to 0
      const result = service.calculateOtMinutes(487, 480, rule);
      expect(result).toBe(0);
    });

    it('should round up when remainder >= half the interval', () => {
      const rule = {
        dailyThresholdMinutes: 480,
        roundingIntervalMinutes: 15,
        maxOtPerDayMinutes: null,
      } as any;

      // 488 minutes worked => 8 minutes OT raw
      // roundMinutes(8, 15): 8 >= 7.5 => rounds up to 15
      const result = service.calculateOtMinutes(488, 480, rule);
      expect(result).toBe(15);
    });

    it('should round exactly half up', () => {
      const rule = {
        dailyThresholdMinutes: 480,
        roundingIntervalMinutes: 30,
        maxOtPerDayMinutes: null,
      } as any;

      // 495 minutes worked => 15 minutes OT raw
      // roundMinutes(15, 30): 15 >= 15 => rounds up to 30
      const result = service.calculateOtMinutes(495, 480, rule);
      expect(result).toBe(30);
    });

    it('should apply max OT per day cap', () => {
      const rule = {
        dailyThresholdMinutes: 480,
        roundingIntervalMinutes: null,
        maxOtPerDayMinutes: 120,
      } as any;

      // 720 minutes worked => 240 minutes OT raw, capped to 120
      const result = service.calculateOtMinutes(720, 480, rule);
      expect(result).toBe(120);
    });

    it('should not cap when OT is below max', () => {
      const rule = {
        dailyThresholdMinutes: 480,
        roundingIntervalMinutes: null,
        maxOtPerDayMinutes: 120,
      } as any;

      const result = service.calculateOtMinutes(540, 480, rule);
      expect(result).toBe(60);
    });

    it('should apply both rounding and max cap together', () => {
      const rule = {
        dailyThresholdMinutes: 480,
        roundingIntervalMinutes: 15,
        maxOtPerDayMinutes: 60,
      } as any;

      // 580 minutes worked => 100 minutes OT raw
      // roundMinutes(100, 15): 100 % 15 = 10, 10 >= 7.5 => round up to 105
      // Then cap at 60
      const result = service.calculateOtMinutes(580, 480, rule);
      expect(result).toBe(60);
    });

    it('should return 0 when worked minutes below threshold with rule', () => {
      const rule = {
        dailyThresholdMinutes: 480,
        roundingIntervalMinutes: 15,
        maxOtPerDayMinutes: 120,
      } as any;

      const result = service.calculateOtMinutes(400, 480, rule);
      expect(result).toBe(0);
    });
  });

  // -----------------------------------------------------------
  // calculateWorkedMinutes
  // -----------------------------------------------------------
  describe('calculateWorkedMinutes', () => {
    it('should return 0 when clockInTime is null', () => {
      const result = service.calculateWorkedMinutes(null, new Date(), 0);
      expect(result).toBe(0);
    });

    it('should return 0 when clockOutTime is null', () => {
      const result = service.calculateWorkedMinutes(new Date(), null, 0);
      expect(result).toBe(0);
    });

    it('should return 0 when both are null', () => {
      const result = service.calculateWorkedMinutes(null, null, 0);
      expect(result).toBe(0);
    });

    it('should calculate difference in minutes minus break', () => {
      const clockIn = new Date('2025-01-15T09:00:00Z');
      const clockOut = new Date('2025-01-15T18:00:00Z');

      // 9 hours = 540 minutes - 60 break = 480
      const result = service.calculateWorkedMinutes(clockIn, clockOut, 60);
      expect(result).toBe(480);
    });

    it('should return 0 when break exceeds the total time', () => {
      const clockIn = new Date('2025-01-15T09:00:00Z');
      const clockOut = new Date('2025-01-15T10:00:00Z');

      // 60 minutes - 120 break = -60, clamped to 0
      const result = service.calculateWorkedMinutes(clockIn, clockOut, 120);
      expect(result).toBe(0);
    });

    it('should default breakMinutes to 0 when not provided', () => {
      const clockIn = new Date('2025-01-15T09:00:00Z');
      const clockOut = new Date('2025-01-15T17:00:00Z');

      const result = service.calculateWorkedMinutes(clockIn, clockOut);
      expect(result).toBe(480);
    });

    it('should floor the minutes (no rounding up)', () => {
      const clockIn = new Date('2025-01-15T09:00:00Z');
      // 8 hours and 30 seconds = 480.5 minutes => floored to 480
      const clockOut = new Date('2025-01-15T17:00:30Z');

      const result = service.calculateWorkedMinutes(clockIn, clockOut, 0);
      expect(result).toBe(480);
    });
  });

  // -----------------------------------------------------------
  // calculateWorkedMinutesFromSessions
  // -----------------------------------------------------------
  describe('calculateWorkedMinutesFromSessions', () => {
    it('should return 0 for empty sessions array', () => {
      const result = service.calculateWorkedMinutesFromSessions([]);
      expect(result).toBe(0);
    });

    it('should skip sessions with no outTime', () => {
      const result = service.calculateWorkedMinutesFromSessions([
        { inTime: new Date('2025-01-15T09:00:00Z'), outTime: null },
      ]);
      expect(result).toBe(0);
    });

    it('should sum up minutes from completed sessions', () => {
      const sessions = [
        {
          inTime: new Date('2025-01-15T09:00:00Z'),
          outTime: new Date('2025-01-15T12:00:00Z'),
        },
        {
          inTime: new Date('2025-01-15T13:00:00Z'),
          outTime: new Date('2025-01-15T17:00:00Z'),
        },
      ];

      // 3 hours + 4 hours = 420 minutes
      const result = service.calculateWorkedMinutesFromSessions(sessions);
      expect(result).toBe(420);
    });

    it('should skip open sessions in a mixed list', () => {
      const sessions = [
        {
          inTime: new Date('2025-01-15T09:00:00Z'),
          outTime: new Date('2025-01-15T12:00:00Z'),
        },
        {
          inTime: new Date('2025-01-15T13:00:00Z'),
          outTime: null,
        },
      ];

      // Only first session counts: 180 minutes
      const result = service.calculateWorkedMinutesFromSessions(sessions);
      expect(result).toBe(180);
    });

    it('should never return negative values from a session', () => {
      // Edge case: outTime before inTime (should not happen but service handles it)
      const sessions = [
        {
          inTime: new Date('2025-01-15T12:00:00Z'),
          outTime: new Date('2025-01-15T09:00:00Z'),
        },
      ];

      const result = service.calculateWorkedMinutesFromSessions(sessions);
      // Math.max(0, negative) = 0
      expect(result).toBe(0);
    });
  });

  // -----------------------------------------------------------
  // checkMonthlyOtLimit
  // -----------------------------------------------------------
  describe('checkMonthlyOtLimit', () => {
    it('should return exceeded: false when rule has no monthly limit', async () => {
      const rule = { maxOtPerMonthMinutes: null } as any;

      const result = await service.checkMonthlyOtLimit(tenantId, 'emp-1', rule, 120);

      expect(result).toEqual({
        exceeded: false,
        currentTotal: 0,
        limit: null,
      });
      // Should NOT query the database
      expect(prisma.attendanceRecord.aggregate).not.toHaveBeenCalled();
    });

    it('should return exceeded: false when within monthly limit', async () => {
      const rule = { maxOtPerMonthMinutes: 2400 } as any;

      prisma.attendanceRecord.aggregate.mockResolvedValue({
        _sum: { otMinutesApproved: 1200 },
      });

      const result = await service.checkMonthlyOtLimit(tenantId, 'emp-1', rule, 120);

      expect(result.exceeded).toBe(false);
      expect(result.currentTotal).toBe(1200);
      expect(result.limit).toBe(2400);
    });

    it('should return exceeded: true when additional OT exceeds monthly limit', async () => {
      const rule = { maxOtPerMonthMinutes: 2400 } as any;

      prisma.attendanceRecord.aggregate.mockResolvedValue({
        _sum: { otMinutesApproved: 2300 },
      });

      const result = await service.checkMonthlyOtLimit(tenantId, 'emp-1', rule, 200);

      // 2300 + 200 = 2500 > 2400
      expect(result.exceeded).toBe(true);
      expect(result.currentTotal).toBe(2300);
    });

    it('should handle null aggregate result (no records)', async () => {
      const rule = { maxOtPerMonthMinutes: 2400 } as any;

      prisma.attendanceRecord.aggregate.mockResolvedValue({
        _sum: { otMinutesApproved: null },
      });

      const result = await service.checkMonthlyOtLimit(tenantId, 'emp-1', rule, 120);

      expect(result.exceeded).toBe(false);
      expect(result.currentTotal).toBe(0);
    });

    it('should query the correct month range', async () => {
      const rule = { maxOtPerMonthMinutes: 2400 } as any;

      prisma.attendanceRecord.aggregate.mockResolvedValue({
        _sum: { otMinutesApproved: 0 },
      });

      await service.checkMonthlyOtLimit(tenantId, 'emp-1', rule, 100);

      expect(prisma.attendanceRecord.aggregate).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId: 'emp-1',
          date: {
            gte: expect.any(Date),
            lte: expect.any(Date),
          },
        },
        _sum: {
          otMinutesApproved: true,
        },
      });
    });
  });
});
