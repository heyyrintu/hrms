import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JobOpeningsService } from './job-openings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, mockHrAdmin, mockManager } from '../../test/helpers';

describe('JobOpeningsService', () => {
  let service: JobOpeningsService;
  let prisma: any;

  const tenantId = mockHrAdmin.tenantId;

  const baseRow = {
    id: 'open-1',
    tenantId,
    requisitionId: null,
    title: 'Backend Engineer',
    slug: 'backend-engineer',
    description: 'Build things',
    requirements: null,
    location: null,
    departmentId: null,
    designationId: null,
    branchId: null,
    employmentType: 'PERMANENT',
    experienceMin: null,
    experienceMax: null,
    salaryMin: null,
    salaryMax: null,
    showSalary: false,
    isPublic: true,
    positions: 1,
    hiringManagerId: mockManager.employeeId,
    status: 'DRAFT',
    publishedAt: null,
    closedAt: null,
    createdById: mockHrAdmin.userId,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z'),
    department: null,
    designation: null,
    branch: null,
    hiringManager: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JobOpeningsService, { provide: PrismaService, useValue: createMockPrismaService() }],
    }).compile();
    service = module.get(JobOpeningsService);
    prisma = module.get(PrismaService);
    prisma.jobApplication.groupBy.mockResolvedValue([]);
  });

  describe('list', () => {
    it('scopes a manager to openings they are hiring manager for', async () => {
      prisma.jobOpening.findMany.mockResolvedValue([]);
      await service.list(mockManager, {});
      expect(prisma.jobOpening.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, hiringManagerId: mockManager.employeeId } }),
      );
    });

    it('returns [] for a manager without an employee record', async () => {
      const result = await service.list({ ...mockManager, employeeId: undefined }, {});
      expect(result).toEqual([]);
      expect(prisma.jobOpening.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('is refused for a MANAGER', async () => {
      await expect(
        service.create(mockManager, { title: 'Engineer', description: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('generates a unique kebab-case slug, appending -2 on a clash', async () => {
      prisma.jobOpening.findUnique
        .mockResolvedValueOnce({ id: 'existing' })
        .mockResolvedValueOnce(null);
      prisma.jobOpening.create.mockResolvedValue(baseRow);

      await service.create(mockHrAdmin, { title: 'Backend Engineer!!', description: 'x' });

      expect(prisma.jobOpening.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'backend-engineer-2' }),
        }),
      );
    });

    it('refuses an opening from a requisition that is not APPROVED', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ status: 'DRAFT', headcount: 2 });

      await expect(
        service.create(mockHrAdmin, {
          title: 'Engineer',
          description: 'x',
          requisitionId: 'req-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses positions that would exceed the requisition headcount', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ status: 'APPROVED', headcount: 2 });
      prisma.jobOpening.aggregate.mockResolvedValue({ _sum: { positions: 2 } });

      await expect(
        service.create(mockHrAdmin, {
          title: 'Engineer',
          description: 'x',
          requisitionId: 'req-1',
          positions: 1,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('publish / hold / close', () => {
    it('publishes a DRAFT opening', async () => {
      prisma.jobOpening.findFirst.mockResolvedValue(baseRow);
      prisma.jobOpening.update.mockResolvedValue({ ...baseRow, status: 'OPEN', publishedAt: new Date() });

      const result = await service.publish(mockHrAdmin, 'open-1');
      expect(result.status).toBe('OPEN');
    });

    it('refuses to publish a CLOSED opening', async () => {
      prisma.jobOpening.findFirst.mockResolvedValue({ ...baseRow, status: 'CLOSED' });
      await expect(service.publish(mockHrAdmin, 'open-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('holds an OPEN opening', async () => {
      prisma.jobOpening.findFirst.mockResolvedValue({ ...baseRow, status: 'OPEN' });
      prisma.jobOpening.update.mockResolvedValue({ ...baseRow, status: 'ON_HOLD' });
      const result = await service.hold(mockHrAdmin, 'open-1');
      expect(result.status).toBe('ON_HOLD');
    });

    it('closes an opening, keeping applications intact (no application writes)', async () => {
      prisma.jobOpening.findFirst.mockResolvedValue({ ...baseRow, status: 'OPEN' });
      prisma.jobOpening.update.mockResolvedValue({ ...baseRow, status: 'CLOSED', closedAt: new Date() });

      const result = await service.close(mockHrAdmin, 'open-1');

      expect(result.status).toBe('CLOSED');
      expect(prisma.jobApplication.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listApplications', () => {
    it('404s for an opening outside the tenant', async () => {
      prisma.jobOpening.findFirst.mockResolvedValue(null);
      await expect(service.listApplications(mockHrAdmin, 'open-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('403s a manager who does not manage the opening', async () => {
      prisma.jobOpening.findFirst.mockResolvedValue({ ...baseRow, hiringManagerId: 'someone-else' });
      await expect(service.listApplications(mockManager, 'open-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lets the hiring manager see the kanban cards', async () => {
      prisma.jobOpening.findFirst.mockResolvedValue(baseRow);
      prisma.jobApplication.findMany.mockResolvedValue([
        {
          id: 'app-1',
          candidate: { id: 'cand-1', firstName: 'A', lastName: 'B', email: 'a@b.com', currentTitle: null },
          stage: { id: 'stage-1', name: 'Applied', sortOrder: 1, category: 'APPLIED', isActive: true },
          status: 'ACTIVE',
          source: 'DIRECT',
          appliedAt: new Date('2026-01-02T00:00:00Z'),
          stageChangedAt: new Date('2026-01-02T00:00:00Z'),
          _count: { interviews: 0 },
        },
      ]);

      const result = await service.listApplications(mockManager, 'open-1');
      expect(result).toHaveLength(1);
      expect(result[0].candidate.id).toBe('cand-1');
    });
  });
});
