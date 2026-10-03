import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CompetenciesService } from './competencies.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('CompetenciesService', () => {
  let service: CompetenciesService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompetenciesService, { provide: PrismaService, useValue: createMockPrismaService() }],
    }).compile();
    service = module.get(CompetenciesService);
    prisma = module.get(PrismaService);
  });

  describe('list', () => {
    it('lists the tenant\'s competencies with the mapped-designation count', async () => {
      prisma.competency.findMany.mockResolvedValue([
        { id: 'c1', name: 'Communication', description: null, category: 'Core', isActive: true, _count: { designations: 3 } },
      ]);
      const result = await service.list('t1');
      expect(prisma.competency.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 't1' }, orderBy: { name: 'asc' } }),
      );
      expect(result).toEqual([
        { id: 'c1', name: 'Communication', description: null, category: 'Core', isActive: true, mappedDesignations: 3 },
      ]);
    });
  });

  describe('create', () => {
    it('creates a competency scoped to the tenant', async () => {
      prisma.competency.create.mockResolvedValue({ id: 'c1', name: 'Teamwork' });
      await service.create('t1', { name: 'Teamwork', category: 'Core' });
      expect(prisma.competency.create).toHaveBeenCalledWith({
        data: { tenantId: 't1', name: 'Teamwork', description: undefined, category: 'Core' },
      });
    });

    it('409s a duplicate name (P2002)', async () => {
      prisma.competency.create.mockRejectedValue(p2002());
      await expect(service.create('t1', { name: 'Teamwork' })).rejects.toThrow(ConflictException);
    });

    it('rethrows other database errors', async () => {
      prisma.competency.create.mockRejectedValue(new Error('boom'));
      await expect(service.create('t1', { name: 'X' })).rejects.toThrow('boom');
    });
  });

  describe('update', () => {
    it('404s a competency outside the tenant', async () => {
      prisma.competency.findFirst.mockResolvedValue(null);
      await expect(service.update('t1', 'missing', { name: 'X' })).rejects.toThrow(NotFoundException);
      expect(prisma.competency.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'missing', tenantId: 't1' } }),
      );
    });

    it('updates only the fields sent, including deactivation', async () => {
      prisma.competency.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.competency.update.mockResolvedValue({ id: 'c1' });
      await service.update('t1', 'c1', { isActive: false });
      expect(prisma.competency.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { isActive: false } });
    });

    it('409s a rename onto an existing name', async () => {
      prisma.competency.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.competency.update.mockRejectedValue(p2002());
      await expect(service.update('t1', 'c1', { name: 'Taken' })).rejects.toThrow(ConflictException);
    });
  });

  describe('remove', () => {
    it('404s a competency outside the tenant', async () => {
      prisma.competency.findFirst.mockResolvedValue(null);
      await expect(service.remove('t1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('refuses (400) when any designation references it', async () => {
      prisma.competency.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.designationCompetency.count.mockResolvedValue(1);
      await expect(service.remove('t1', 'c1')).rejects.toThrow(BadRequestException);
      expect(prisma.competency.delete).not.toHaveBeenCalled();
      expect(prisma.designationCompetency.count).toHaveBeenCalledWith({
        where: { tenantId: 't1', competencyId: 'c1' },
      });
    });

    it('deletes an unreferenced competency', async () => {
      prisma.competency.findFirst.mockResolvedValue({ id: 'c1' });
      prisma.designationCompetency.count.mockResolvedValue(0);
      prisma.competency.delete.mockResolvedValue({});
      expect(await service.remove('t1', 'c1')).toEqual({ message: 'Competency deleted' });
      expect(prisma.competency.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });
  });

  describe('getForDesignation', () => {
    it('404s a designation outside the tenant', async () => {
      prisma.designation.findFirst.mockResolvedValue(null);
      await expect(service.getForDesignation('t1', 'dz')).rejects.toThrow(NotFoundException);
      expect(prisma.designation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'dz', tenantId: 't1' } }),
      );
    });

    it('returns the mapped competencies with names', async () => {
      prisma.designation.findFirst.mockResolvedValue({ id: 'd1' });
      const rows = [{ competencyId: 'c1', expectedLevel: 3, competency: { id: 'c1', name: 'A', isActive: true } }];
      prisma.designationCompetency.findMany.mockResolvedValue(rows);
      expect(await service.getForDesignation('t1', 'd1')).toEqual(rows);
      expect(prisma.designationCompetency.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
        designationId: 'd1',
      });
    });
  });

  describe('setForDesignation', () => {
    const items = [
      { competencyId: 'c1', expectedLevel: 3 },
      { competencyId: 'c2', expectedLevel: 5 },
    ];

    beforeEach(() => {
      prisma.designation.findFirst.mockResolvedValue({ id: 'd1' });
      prisma.competency.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      prisma.designationCompetency.deleteMany.mockResolvedValue({ count: 0 });
      prisma.designationCompetency.createMany.mockResolvedValue({ count: 2 });
      prisma.designationCompetency.findMany.mockResolvedValue([]);
    });

    it('404s a designation outside the tenant', async () => {
      prisma.designation.findFirst.mockResolvedValue(null);
      await expect(service.setForDesignation('t1', 'dz', { items })).rejects.toThrow(NotFoundException);
      expect(prisma.designationCompetency.deleteMany).not.toHaveBeenCalled();
    });

    it('400s duplicate competency ids before touching the database', async () => {
      await expect(
        service.setForDesignation('t1', 'd1', {
          items: [
            { competencyId: 'c1', expectedLevel: 2 },
            { competencyId: 'c1', expectedLevel: 4 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.designationCompetency.deleteMany).not.toHaveBeenCalled();
    });

    it('400s a competency from another tenant or an inactive one', async () => {
      prisma.competency.findMany.mockResolvedValue([{ id: 'c1' }]); // c2 not found / inactive
      await expect(service.setForDesignation('t1', 'd1', { items })).rejects.toThrow(BadRequestException);
      expect(prisma.competency.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['c1', 'c2'] }, tenantId: 't1', isActive: true } }),
      );
      expect(prisma.designationCompetency.deleteMany).not.toHaveBeenCalled();
    });

    it('400s an expected level outside 1-5', async () => {
      await expect(
        service.setForDesignation('t1', 'd1', { items: [{ competencyId: 'c1', expectedLevel: 6 }] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setForDesignation('t1', 'd1', { items: [{ competencyId: 'c1', expectedLevel: 0 }] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('replaces the list in one transaction (deleteMany then createMany) and returns it with names', async () => {
      const after = [{ competencyId: 'c1', expectedLevel: 3, competency: { id: 'c1', name: 'A', isActive: true } }];
      prisma.designationCompetency.findMany.mockResolvedValue(after);

      const result = await service.setForDesignation('t1', 'd1', { items });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.designationCompetency.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: 't1', designationId: 'd1' },
      });
      expect(prisma.designationCompetency.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId: 't1', designationId: 'd1', competencyId: 'c1', expectedLevel: 3 },
          { tenantId: 't1', designationId: 'd1', competencyId: 'c2', expectedLevel: 5 },
        ],
      });
      expect(prisma.designationCompetency.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.designationCompetency.createMany.mock.invocationCallOrder[0],
      );
      expect(result).toEqual(after);
    });

    it('an empty list clears the mapping without a createMany', async () => {
      await service.setForDesignation('t1', 'd1', { items: [] });
      expect(prisma.designationCompetency.deleteMany).toHaveBeenCalled();
      expect(prisma.designationCompetency.createMany).not.toHaveBeenCalled();
    });
  });
});
