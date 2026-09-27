import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PipelineStagesService } from './pipeline-stages.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { DEFAULT_PIPELINE_STAGES } from './recruitment.types';

describe('PipelineStagesService', () => {
  let service: PipelineStagesService;
  let prisma: any;

  const tenantId = 'tenant-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PipelineStagesService, { provide: PrismaService, useValue: createMockPrismaService() }],
    }).compile();
    service = module.get(PipelineStagesService);
    prisma = module.get(PrismaService);
  });

  describe('ensureDefaults', () => {
    it('creates the six default stages when none exist', async () => {
      prisma.pipelineStage.count.mockResolvedValue(0);
      prisma.pipelineStage.createMany.mockResolvedValue({ count: 6 });

      await service.ensureDefaults(tenantId);

      expect(prisma.pipelineStage.createMany).toHaveBeenCalledWith({
        data: DEFAULT_PIPELINE_STAGES.map((stage, index) => ({
          tenantId,
          name: stage.name,
          category: stage.category,
          sortOrder: index + 1,
        })),
        skipDuplicates: true,
      });
    });

    it('does nothing when stages already exist', async () => {
      prisma.pipelineStage.count.mockResolvedValue(6);

      await service.ensureDefaults(tenantId);

      expect(prisma.pipelineStage.createMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('ensures defaults then returns active stages ordered', async () => {
      prisma.pipelineStage.count.mockResolvedValue(6);
      prisma.pipelineStage.findMany.mockResolvedValue([
        { id: 's1', name: 'Applied', sortOrder: 1, category: 'APPLIED', isActive: true },
      ]);

      const result = await service.list(tenantId);

      expect(prisma.pipelineStage.findMany).toHaveBeenCalledWith({
        where: { tenantId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      });
      expect(result).toEqual([
        { id: 's1', name: 'Applied', sortOrder: 1, category: 'APPLIED', isActive: true },
      ]);
    });

    it('includes inactive stages when requested', async () => {
      prisma.pipelineStage.count.mockResolvedValue(6);
      prisma.pipelineStage.findMany.mockResolvedValue([]);

      await service.list(tenantId, true);

      expect(prisma.pipelineStage.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        orderBy: { sortOrder: 'asc' },
      });
    });
  });

  describe('replace', () => {
    const validStages = [
      { name: 'Applied', category: 'APPLIED' as const },
      { name: 'Screening', category: 'SCREENING' as const },
      { name: 'Hired', category: 'HIRED' as const },
      { name: 'Rejected', category: 'REJECTED' as const },
    ];

    function stubTransaction() {
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
    }

    it('rejects an empty list', async () => {
      await expect(service.replace(tenantId, [])).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate names (case-insensitive)', async () => {
      await expect(
        service.replace(tenantId, [
          { name: 'Applied', category: 'APPLIED' as const },
          { name: 'applied', category: 'HIRED' as const },
          { name: 'Rejected', category: 'REJECTED' as const },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires at least one stage in APPLIED, HIRED and REJECTED', async () => {
      await expect(
        service.replace(tenantId, [{ name: 'Applied', category: 'APPLIED' as const }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires the first stage to be APPLIED', async () => {
      await expect(
        service.replace(tenantId, [
          { name: 'Screening', category: 'SCREENING' as const },
          { name: 'Applied', category: 'APPLIED' as const },
          { name: 'Hired', category: 'HIRED' as const },
          { name: 'Rejected', category: 'REJECTED' as const },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an id that does not belong to the tenant', async () => {
      prisma.pipelineStage.findMany.mockResolvedValueOnce([]);
      await expect(
        service.replace(tenantId, [
          { id: 'foreign-id', name: 'Applied', category: 'APPLIED' as const },
          { name: 'Hired', category: 'HIRED' as const },
          { name: 'Rejected', category: 'REJECTED' as const },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('deactivates stages not kept and creates/updates the rest, then returns the full list', async () => {
      prisma.pipelineStage.findMany.mockResolvedValueOnce([
        { id: 'existing-1', name: 'Applied', sortOrder: 1, category: 'APPLIED', isActive: true },
        { id: 'legacy-onsite', name: 'Onsite', sortOrder: 2, category: 'INTERVIEW', isActive: true },
      ]);
      stubTransaction();
      prisma.pipelineStage.update.mockResolvedValue({});
      prisma.pipelineStage.create.mockResolvedValue({});
      // list() call at the end
      prisma.pipelineStage.count.mockResolvedValue(2);
      prisma.pipelineStage.findMany.mockResolvedValueOnce([]);

      await service.replace(tenantId, [
        { id: 'existing-1', name: 'Applied', category: 'APPLIED' as const },
        ...validStages.slice(1),
      ]);

      expect(prisma.pipelineStage.update).toHaveBeenCalledWith({
        where: { id: 'legacy-onsite' },
        data: { isActive: false },
      });
      expect(prisma.pipelineStage.update).toHaveBeenCalledWith({
        where: { id: 'existing-1' },
        data: { name: 'Applied', category: 'APPLIED', sortOrder: 1, isActive: true },
      });
      expect(prisma.pipelineStage.create).toHaveBeenCalledWith({
        data: { tenantId, name: 'Screening', category: 'SCREENING', sortOrder: 2, isActive: true },
      });
    });
  });
});
