import { Test, TestingModule } from '@nestjs/testing';
import { FeedCelebrationsService, matchesToday } from './feed-celebrations.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { EngagementSettingsService } from '../settings/engagement-settings.service';
import { FeedService } from './feed.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('matchesToday', () => {
  it('matches an ordinary month/day', () => {
    expect(matchesToday(3, 15, { year: 2026, month: 3, day: 15 })).toBe(true);
    expect(matchesToday(3, 15, { year: 2026, month: 3, day: 16 })).toBe(false);
  });

  it('rolls a 29 Feb birthday onto 28 Feb in a non-leap year', () => {
    expect(matchesToday(2, 29, { year: 2027, month: 2, day: 28 })).toBe(true);
  });

  it('does not roll 29 Feb onto 28 Feb in a leap year (29 Feb exists)', () => {
    expect(matchesToday(2, 29, { year: 2028, month: 2, day: 28 })).toBe(false);
    expect(matchesToday(2, 29, { year: 2028, month: 2, day: 29 })).toBe(true);
  });
});

describe('FeedCelebrationsService', () => {
  let service: FeedCelebrationsService;
  let prisma: any;
  let settings: { get: jest.Mock };
  let feed: { post: jest.Mock };

  const tenantId = 'tenant-1';

  beforeEach(async () => {
    settings = {
      get: jest.fn().mockResolvedValue({
        pointsEnabled: false,
        monthlyPointsAllowance: 100,
        showBirthdays: true,
        showAnniversaries: true,
      }),
    };
    feed = { post: jest.fn().mockResolvedValue({ id: 'feed-1', created: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedCelebrationsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: EngagementSettingsService, useValue: settings },
        { provide: FeedService, useValue: feed },
      ],
    }).compile();

    service = module.get(FeedCelebrationsService);
    prisma = module.get(PrismaService);
  });

  describe('runForTenant', () => {
    // 15 March 2026 12:00 UTC is comfortably inside the IST day 2026-03-15.
    const now = new Date('2026-03-15T12:00:00Z');

    it('posts a birthday item for an employee born on this day', async () => {
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-1',
          firstName: 'Ann',
          lastName: 'Employee',
          dateOfBirth: new Date('1990-03-15T00:00:00Z'),
          joinDate: new Date('2020-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.runForTenant(tenantId, now);

      expect(feed.post).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          type: 'BIRTHDAY',
          sourceType: 'Employee',
          sourceId: 'emp-1',
          subjectEmployeeId: 'emp-1',
          dedupeKey: 'birthday:emp-1:2026',
          title: 'Happy birthday, Ann!',
          payload: {},
        }),
      );
      expect(result.created).toBe(1);
    });

    it('never puts a birth year in the birthday payload', async () => {
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-1',
          firstName: 'Ann',
          lastName: 'Employee',
          dateOfBirth: new Date('1990-03-15T00:00:00Z'),
          joinDate: new Date('2020-01-01T00:00:00Z'),
        },
      ]);

      await service.runForTenant(tenantId, now);

      const call = feed.post.mock.calls.find((c) => c[0].type === 'BIRTHDAY');
      expect(call[0].payload).toEqual({});
      expect(JSON.stringify(call[0].payload)).not.toContain('1990');
    });

    it('rolls a 29 Feb birthday onto 28 Feb in a non-leap year', async () => {
      const feb28NonLeap = new Date('2027-02-28T12:00:00Z');
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-leap',
          firstName: 'Leo',
          lastName: 'Leap',
          dateOfBirth: new Date('1992-02-29T00:00:00Z'),
          joinDate: new Date('2020-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.runForTenant(tenantId, feb28NonLeap);

      expect(feed.post).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'BIRTHDAY', sourceId: 'emp-leap' }),
      );
      expect(result.created).toBe(1);
    });

    it('does not roll 29 Feb onto 28 Feb in a leap year', async () => {
      const feb28Leap = new Date('2028-02-28T12:00:00Z');
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-leap',
          firstName: 'Leo',
          lastName: 'Leap',
          dateOfBirth: new Date('1992-02-29T00:00:00Z'),
          joinDate: new Date('2020-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.runForTenant(tenantId, feb28Leap);

      expect(feed.post).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
    });

    it('posts a work anniversary with the correct year count, pluralised', async () => {
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-2',
          firstName: 'Bob',
          lastName: 'Builder',
          dateOfBirth: null,
          joinDate: new Date('2023-03-15T00:00:00Z'),
        },
      ]);

      const result = await service.runForTenant(tenantId, now);

      expect(feed.post).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'WORK_ANNIVERSARY',
          sourceType: 'Employee',
          sourceId: 'emp-2',
          dedupeKey: 'anniversary:emp-2:2026',
          title: 'Bob Builder completes 3 years with us',
          payload: { years: 3 },
        }),
      );
      expect(result.created).toBe(1);
    });

    it('does not post an anniversary for someone who joined this year (years < 1)', async () => {
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-3',
          firstName: 'New',
          lastName: 'Hire',
          dateOfBirth: null,
          joinDate: new Date('2026-03-15T00:00:00Z'),
        },
      ]);

      const result = await service.runForTenant(tenantId, now);

      expect(feed.post).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
    });

    it('skips birthday posts when showBirthdays is off', async () => {
      settings.get.mockResolvedValue({
        pointsEnabled: false,
        monthlyPointsAllowance: 100,
        showBirthdays: false,
        showAnniversaries: true,
      });
      prisma.employee.findMany.mockResolvedValue([
        {
          id: 'emp-1',
          firstName: 'Ann',
          lastName: 'Employee',
          dateOfBirth: new Date('1990-03-15T00:00:00Z'),
          joinDate: new Date('2020-01-01T00:00:00Z'),
        },
      ]);

      const result = await service.runForTenant(tenantId, now);

      expect(feed.post).not.toHaveBeenCalled();
      expect(result.created).toBe(0);
    });

    it('queries only ACTIVE employees', async () => {
      prisma.employee.findMany.mockResolvedValue([]);

      await service.runForTenant(tenantId, now);

      expect(prisma.employee.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'ACTIVE' } }),
      );
    });
  });

  describe('runForAllTenants', () => {
    const now = new Date('2026-03-15T12:00:00Z');

    it('sums created counts across tenants', async () => {
      prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      prisma.employee.findMany
        .mockResolvedValueOnce([
          {
            id: 'emp-1',
            firstName: 'Ann',
            lastName: 'A',
            dateOfBirth: new Date('1990-03-15T00:00:00Z'),
            joinDate: new Date('2020-01-01T00:00:00Z'),
          },
        ])
        .mockResolvedValueOnce([]);

      const result = await service.runForAllTenants(now);

      expect(result.tenants).toBe(2);
      expect(result.created).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('does not let one failing tenant stop the next', async () => {
      prisma.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
      prisma.employee.findMany
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce([]);

      const result = await service.runForAllTenants(now);

      expect(result.tenants).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('queries only active tenants', async () => {
      prisma.tenant.findMany.mockResolvedValue([]);

      await service.runForAllTenants(now);

      expect(prisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });
});
