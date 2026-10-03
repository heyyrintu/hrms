import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { ShiftResolverService } from './shift-resolver.service';

const TENANT = 't-1';

const dayShift = { id: 's-day', code: 'GEN', isActive: true, isOvernight: false };
const nightShift = { id: 's-night', code: 'NGT', isActive: true, isOvernight: true };

describe('ShiftResolverService (scaffold: assignments only)', () => {
  let service: ShiftResolverService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShiftResolverService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get(ShiftResolverService);
    prisma = module.get(PrismaService);
  });

  describe('shiftOn', () => {
    it("returns the covering assignment's active shift", async () => {
      prisma.shiftAssignment.findFirst.mockResolvedValue({ id: 'sa-1', shift: dayShift });

      const date = new Date('2026-03-16T00:00:00.000Z');
      const shift = await service.shiftOn(TENANT, 'e-1', date);

      expect(shift).toBe(dayShift);
      const args = prisma.shiftAssignment.findFirst.mock.calls[0][0];
      expect(args.where).toMatchObject({
        tenantId: TENANT,
        employeeId: 'e-1',
        isActive: true,
        startDate: { lte: date },
      });
      expect(args.orderBy).toEqual({ startDate: 'desc' });
    });

    it('returns null when the assigned shift is inactive', async () => {
      prisma.shiftAssignment.findFirst.mockResolvedValue({
        id: 'sa-1',
        shift: { ...dayShift, isActive: false },
      });

      await expect(
        service.shiftOn(TENANT, 'e-1', new Date('2026-03-16T00:00:00.000Z')),
      ).resolves.toBeNull();
    });

    it('returns null when there is no assignment', async () => {
      prisma.shiftAssignment.findFirst.mockResolvedValue(null);

      await expect(
        service.shiftOn(TENANT, 'e-1', new Date('2026-03-16T00:00:00.000Z')),
      ).resolves.toBeNull();
    });
  });

  describe('dayOn', () => {
    it('reports ASSIGNMENT with the shift, never OFF', async () => {
      prisma.shiftAssignment.findFirst.mockResolvedValue({ id: 'sa-1', shift: nightShift });
      const date = new Date('2026-03-16T00:00:00.000Z');

      await expect(service.dayOn(TENANT, 'e-1', date)).resolves.toEqual({
        employeeId: 'e-1',
        date,
        shift: nightShift,
        isOff: false,
        source: 'ASSIGNMENT',
      });
    });

    it('reports NONE with no shift', async () => {
      prisma.shiftAssignment.findFirst.mockResolvedValue(null);
      const date = new Date('2026-03-16T00:00:00.000Z');

      await expect(service.dayOn(TENANT, 'e-1', date)).resolves.toEqual({
        employeeId: 'e-1',
        date,
        shift: null,
        isOff: false,
        source: 'NONE',
      });
    });
  });

  describe('daysFor', () => {
    it('returns one entry per employee per day with a single query', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([
        // Newest first: e-1 moves to nights from the 17th.
        {
          employeeId: 'e-1',
          startDate: new Date('2026-03-17T00:00:00.000Z'),
          endDate: null,
          shift: nightShift,
        },
        {
          employeeId: 'e-1',
          startDate: new Date('2026-03-01T00:00:00.000Z'),
          endDate: null,
          shift: dayShift,
        },
      ]);

      const days = await service.daysFor(
        TENANT,
        ['e-1', 'e-2'],
        new Date('2026-03-16T12:00:00Z'),
        new Date('2026-03-18T12:00:00Z'),
      );

      expect(prisma.shiftAssignment.findMany).toHaveBeenCalledTimes(1);
      const args = prisma.shiftAssignment.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        tenantId: TENANT,
        employeeId: { in: ['e-1', 'e-2'] },
        isActive: true,
        startDate: { lte: new Date('2026-03-18T00:00:00.000Z') },
        OR: [{ endDate: null }, { endDate: { gte: new Date('2026-03-16T00:00:00.000Z') } }],
      });
      expect(args.orderBy).toEqual({ startDate: 'desc' });

      expect(days).toHaveLength(6);
      expect(
        days.map((d) => [d.employeeId, d.date.toISOString().slice(0, 10), d.shift?.id ?? null, d.source]),
      ).toEqual([
        ['e-1', '2026-03-16', 's-day', 'ASSIGNMENT'],
        ['e-1', '2026-03-17', 's-night', 'ASSIGNMENT'],
        ['e-1', '2026-03-18', 's-night', 'ASSIGNMENT'],
        ['e-2', '2026-03-16', null, 'NONE'],
        ['e-2', '2026-03-17', null, 'NONE'],
        ['e-2', '2026-03-18', null, 'NONE'],
      ]);
      expect(days.every((d) => d.isOff === false)).toBe(true);
    });

    it('treats an inactive shift as no shift without falling back', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([
        {
          employeeId: 'e-1',
          startDate: new Date('2026-03-10T00:00:00.000Z'),
          endDate: null,
          shift: { ...nightShift, isActive: false },
        },
        {
          employeeId: 'e-1',
          startDate: new Date('2026-03-01T00:00:00.000Z'),
          endDate: null,
          shift: dayShift,
        },
      ]);

      const [day] = await service.daysFor(
        TENANT,
        ['e-1'],
        new Date('2026-03-16T12:00:00Z'),
        new Date('2026-03-16T12:00:00Z'),
      );

      expect(day.shift).toBeNull();
      expect(day.source).toBe('NONE');
    });

    it('respects an assignment end date', async () => {
      prisma.shiftAssignment.findMany.mockResolvedValue([
        {
          employeeId: 'e-1',
          startDate: new Date('2026-03-01T00:00:00.000Z'),
          endDate: new Date('2026-03-16T00:00:00.000Z'),
          shift: dayShift,
        },
      ]);

      const days = await service.daysFor(
        TENANT,
        ['e-1'],
        new Date('2026-03-16T12:00:00Z'),
        new Date('2026-03-17T12:00:00Z'),
      );

      expect(days.map((d) => d.source)).toEqual(['ASSIGNMENT', 'NONE']);
    });

    it('makes no query for no employees', async () => {
      await expect(
        service.daysFor(TENANT, [], new Date('2026-03-16T12:00:00Z'), new Date('2026-03-17T12:00:00Z')),
      ).resolves.toEqual([]);
      expect(prisma.shiftAssignment.findMany).not.toHaveBeenCalled();
    });
  });
});
