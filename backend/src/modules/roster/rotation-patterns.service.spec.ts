import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, mockHrAdmin } from '../../test/helpers';
import { RotationPatternsService } from './rotation-patterns.service';

const TENANT = mockHrAdmin.tenantId;

describe('RotationPatternsService', () => {
  let service: RotationPatternsService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RotationPatternsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();
    service = module.get(RotationPatternsService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('creates the pattern with nested days and the cycle length', async () => {
      prisma.shift.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);
      prisma.shiftRotationPattern.create.mockResolvedValue({ id: 'p1' });

      await service.create(mockHrAdmin, { name: '2 on 1 off', days: ['s1', 's2', null] });

      expect(prisma.shift.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, id: { in: ['s1', 's2'] }, isActive: true },
        select: { id: true },
      });
      const args = prisma.shiftRotationPattern.create.mock.calls[0][0];
      expect(args.data).toMatchObject({
        tenantId: TENANT,
        name: '2 on 1 off',
        cycleLength: 3,
        createdById: mockHrAdmin.userId,
      });
      expect(args.data.days.create).toEqual([
        { dayIndex: 0, shiftId: 's1' },
        { dayIndex: 1, shiftId: 's2' },
        { dayIndex: 2, shiftId: null },
      ]);
      expect(args.include).toEqual({ days: { orderBy: { dayIndex: 'asc' } } });
    });

    it('accepts an all-OFF pattern without looking up shifts', async () => {
      prisma.shiftRotationPattern.create.mockResolvedValue({ id: 'p1' });
      await service.create(mockHrAdmin, { name: 'Off', days: [null] });
      expect(prisma.shift.findMany).not.toHaveBeenCalled();
    });

    it('rejects 0 days and more than 31 days', async () => {
      await expect(service.create(mockHrAdmin, { name: 'x', days: [] })).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.create(mockHrAdmin, { name: 'x', days: new Array(32).fill(null) }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.shiftRotationPattern.create).not.toHaveBeenCalled();
    });

    it('rejects a shift that is not an active shift in the tenant', async () => {
      prisma.shift.findMany.mockResolvedValue([{ id: 's1' }]);
      await expect(
        service.create(mockHrAdmin, { name: 'x', days: ['s1', 'other-tenant'] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.shiftRotationPattern.create).not.toHaveBeenCalled();
    });

    it('counts a repeated shift once when validating', async () => {
      prisma.shift.findMany.mockResolvedValue([{ id: 's1' }]);
      prisma.shiftRotationPattern.create.mockResolvedValue({ id: 'p1' });
      await service.create(mockHrAdmin, { name: 'x', days: ['s1', 's1', null] });
      expect(prisma.shift.findMany.mock.calls[0][0].where.id).toEqual({ in: ['s1'] });
    });
  });

  describe('update', () => {
    it('replaces the days in a transaction', async () => {
      prisma.shiftRotationPattern.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.shift.findMany.mockResolvedValue([{ id: 's1' }]);
      prisma.shiftRotationPattern.update.mockResolvedValue({ id: 'p1', days: [] });

      await service.update(TENANT, 'p1', { name: 'New', description: 'd', days: ['s1', null] });

      expect(prisma.shiftRotationPattern.findFirst).toHaveBeenCalledWith({
        where: { id: 'p1', tenantId: TENANT, isActive: true },
        select: { id: true },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.shiftRotationPatternDay.deleteMany).toHaveBeenCalledWith({
        where: { patternId: 'p1' },
      });
      expect(prisma.shiftRotationPatternDay.createMany).toHaveBeenCalledWith({
        data: [
          { patternId: 'p1', dayIndex: 0, shiftId: 's1' },
          { patternId: 'p1', dayIndex: 1, shiftId: null },
        ],
      });
      const args = prisma.shiftRotationPattern.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'p1' });
      expect(args.data).toEqual({ name: 'New', description: 'd', cycleLength: 2 });
      expect(args.include).toEqual({ days: { orderBy: { dayIndex: 'asc' } } });
    });

    it('404s for a pattern that is missing, inactive or in another tenant', async () => {
      prisma.shiftRotationPattern.findFirst.mockResolvedValue(null);
      await expect(service.update(TENANT, 'nope', { name: 'x', days: [null] })).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.shiftRotationPatternDay.deleteMany).not.toHaveBeenCalled();
    });

    it('validates days before touching anything', async () => {
      prisma.shiftRotationPattern.findFirst.mockResolvedValue({ id: 'p1' });
      prisma.shift.findMany.mockResolvedValue([]);
      await expect(service.update(TENANT, 'p1', { name: 'x', days: ['bad'] })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.shiftRotationPatternDay.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft deletes', async () => {
      prisma.shiftRotationPattern.updateMany.mockResolvedValue({ count: 1 });
      await service.remove(TENANT, 'p1');
      expect(prisma.shiftRotationPattern.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', tenantId: TENANT, isActive: true },
        data: { isActive: false },
      });
    });

    it('404s when nothing was deactivated', async () => {
      prisma.shiftRotationPattern.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.remove(TENANT, 'p1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('list', () => {
    it('returns active patterns with days ordered by index', async () => {
      prisma.shiftRotationPattern.findMany.mockResolvedValue([{ id: 'p1' }]);
      await expect(service.list(TENANT)).resolves.toEqual([{ id: 'p1' }]);
      expect(prisma.shiftRotationPattern.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, isActive: true },
        include: { days: { orderBy: { dayIndex: 'asc' } } },
        orderBy: { name: 'asc' },
      });
    });
  });
});
