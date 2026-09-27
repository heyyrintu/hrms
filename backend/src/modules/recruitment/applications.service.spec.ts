import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { PipelineStagesService } from './pipeline-stages.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, mockHrAdmin, mockManager } from '../../test/helpers';

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let prisma: any;
  let stages: { ensureDefaults: jest.Mock };

  const tenantId = mockHrAdmin.tenantId;

  const appliedStage = { id: 'stage-applied', name: 'Applied', sortOrder: 1, category: 'APPLIED', isActive: true };
  const rejectedStage = { id: 'stage-rejected', name: 'Rejected', sortOrder: 6, category: 'REJECTED', isActive: true };
  const hiredStage = { id: 'stage-hired', name: 'Hired', sortOrder: 5, category: 'HIRED', isActive: true };

  const detailRow = {
    id: 'app-1',
    tenantId,
    candidateId: 'cand-1',
    jobOpeningId: 'open-1',
    stageId: 'stage-applied',
    status: 'ACTIVE',
    source: 'DIRECT',
    resumeUploadId: null,
    coverLetter: null,
    rejectionReason: null,
    appliedAt: new Date('2026-01-02T00:00:00Z'),
    stageChangedAt: new Date('2026-01-02T00:00:00Z'),
    hiredAt: null,
    createdById: mockHrAdmin.userId,
    createdAt: new Date('2026-01-02T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    candidate: {
      id: 'cand-1',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: null,
      currentCompany: null,
      currentTitle: null,
      totalExperienceYears: null,
      currentCtc: '2000000',
      expectedCtc: null,
      noticePeriodDays: null,
      location: null,
      linkedinUrl: null,
      source: 'DIRECT',
      referredBy: null,
      resumeUpload: null,
      notes: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    jobOpening: { id: 'open-1', title: 'Engineer', hiringManagerId: mockManager.employeeId, requisitionId: null },
    stage: appliedStage,
    resumeUpload: null,
    stageEvents: [],
  };

  beforeEach(async () => {
    stages = { ensureDefaults: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: PipelineStagesService, useValue: stages },
      ],
    }).compile();
    service = module.get(ApplicationsService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('is refused for a MANAGER', async () => {
      await expect(
        service.create(mockManager, { candidateId: 'cand-1', jobOpeningId: 'open-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('starts the application at the first active APPLIED stage with a stage event', async () => {
      prisma.candidate.findFirst.mockResolvedValue({ id: 'cand-1', source: 'DIRECT' });
      prisma.jobOpening.findFirst.mockResolvedValue({ id: 'open-1' });
      prisma.pipelineStage.findFirst.mockResolvedValue(appliedStage);
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
      prisma.jobApplication.create.mockResolvedValue({ id: 'app-1' });
      prisma.jobApplication.findFirst.mockResolvedValue(detailRow);

      await service.create(mockHrAdmin, { candidateId: 'cand-1', jobOpeningId: 'open-1' });

      expect(prisma.jobApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ stageId: 'stage-applied', status: 'ACTIVE' }),
        }),
      );
      expect(prisma.jobApplicationStageEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ fromStageId: null, toStageId: 'stage-applied' }),
        }),
      );
    });

    it('409s a duplicate (opening, candidate) application', async () => {
      prisma.candidate.findFirst.mockResolvedValue({ id: 'cand-1', source: 'DIRECT' });
      prisma.jobOpening.findFirst.mockResolvedValue({ id: 'open-1' });
      prisma.pipelineStage.findFirst.mockResolvedValue(appliedStage);
      prisma.$transaction.mockImplementation(async () => {
        throw { code: 'P2002' };
      });

      await expect(
        service.create(mockHrAdmin, { candidateId: 'cand-1', jobOpeningId: 'open-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('get', () => {
    it('403s a manager who does not manage the opening', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue({
        ...detailRow,
        jobOpening: { ...detailRow.jobOpening, hiringManagerId: 'someone-else' },
      });
      await expect(service.get(mockManager, 'app-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('masks candidate CTC for a non-HR viewer', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(detailRow);
      const result = await service.get(mockManager, 'app-1');
      expect(result.candidate.currentCtc).toBeNull();
    });

    it('shows candidate CTC to HR', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue({
        ...detailRow,
        jobOpening: { ...detailRow.jobOpening, hiringManagerId: null },
      });
      const result = await service.get(mockHrAdmin, 'app-1');
      expect(result.candidate.currentCtc).toBe(2000000);
    });

    it('404s an application outside the tenant', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(null);
      await expect(service.get(mockHrAdmin, 'app-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('moveToStage', () => {
    it('404s when the application does not exist', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(null);
      await expect(
        service.moveToStage({ tenantId, applicationId: 'app-1', toStageId: 'stage-2', actorUserId: 'u1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to move an application that is not ACTIVE', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue({ ...detailRow, status: 'WITHDRAWN' });
      await expect(
        service.moveToStage({ tenantId, applicationId: 'app-1', toStageId: 'stage-2', actorUserId: 'u1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('requires a rejection reason to move into a REJECTED-category stage', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(detailRow);
      prisma.pipelineStage.findFirst.mockResolvedValue(rejectedStage);
      await expect(
        service.moveToStage({ tenantId, applicationId: 'app-1', toStageId: 'stage-rejected', actorUserId: 'u1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sets status REJECTED and records the reason when moved to a REJECTED stage', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(detailRow);
      prisma.pipelineStage.findFirst.mockResolvedValue(rejectedStage);
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));

      await service.moveToStage({
        tenantId,
        applicationId: 'app-1',
        toStageId: 'stage-rejected',
        actorUserId: 'u1',
        rejectionReason: 'Not a fit',
      });

      expect(prisma.jobApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: expect.objectContaining({
          stageId: 'stage-rejected',
          status: 'REJECTED',
          rejectionReason: 'Not a fit',
        }),
      });
    });

    it('sets status HIRED and hiredAt when moved to a HIRED-category stage by category', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(detailRow);
      prisma.pipelineStage.findFirst.mockResolvedValue(hiredStage);
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));

      await service.moveToStage({ tenantId, applicationId: 'app-1', toCategory: 'HIRED', actorUserId: null });

      expect(prisma.jobApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: expect.objectContaining({ status: 'HIRED', hiredAt: expect.any(Date) }),
      });
    });

    it('runs inside the caller-supplied transaction without opening its own', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(detailRow);
      prisma.pipelineStage.findFirst.mockResolvedValue(hiredStage);
      const tx = { ...prisma };

      await service.moveToStage({ tenantId, applicationId: 'app-1', toCategory: 'HIRED', actorUserId: null, tx });

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.jobApplication.update).toHaveBeenCalled();
    });
  });

  describe('reject / withdraw', () => {
    it('reject moves to the first active REJECTED stage with the reason', async () => {
      prisma.jobApplication.findFirst
        .mockResolvedValueOnce(detailRow) // findScoped
        .mockResolvedValueOnce(detailRow) // moveToStage read
        .mockResolvedValueOnce({ ...detailRow, status: 'REJECTED' }); // final get
      prisma.pipelineStage.findFirst.mockResolvedValue(rejectedStage);
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));

      const result = await service.reject(mockHrAdmin, 'app-1', 'Not a fit');
      expect(result.status).toBe('REJECTED');
    });

    it('withdraw is refused for a MANAGER', async () => {
      prisma.jobApplication.findFirst.mockResolvedValue(detailRow);
      await expect(service.withdraw(mockManager, 'app-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('withdraw sets status WITHDRAWN for HR', async () => {
      prisma.jobApplication.findFirst
        .mockResolvedValueOnce(detailRow)
        .mockResolvedValueOnce({ ...detailRow, status: 'WITHDRAWN' });
      prisma.jobApplication.update.mockResolvedValue({});

      const result = await service.withdraw(mockHrAdmin, 'app-1');
      expect(prisma.jobApplication.update).toHaveBeenCalledWith({
        where: { id: 'app-1' },
        data: { status: 'WITHDRAWN' },
      });
      expect(result.status).toBe('WITHDRAWN');
    });
  });

  describe('createFromCareers', () => {
    it('returns { created: false } for a duplicate application without throwing', async () => {
      prisma.jobApplication.findUnique.mockResolvedValue({ id: 'existing-app' });

      const result = await service.createFromCareers({
        tenantId,
        jobOpeningId: 'open-1',
        candidateId: 'cand-1',
        resumeUploadId: null,
      });

      expect(result).toEqual({ created: false, applicationId: 'existing-app' });
      expect(prisma.jobApplication.create).not.toHaveBeenCalled();
    });

    it('creates with source CAREERS_PAGE and a system stage event (movedById null)', async () => {
      prisma.jobApplication.findUnique.mockResolvedValue(null);
      prisma.pipelineStage.findFirst.mockResolvedValue(appliedStage);
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
      prisma.jobApplication.create.mockResolvedValue({ id: 'new-app' });

      const result = await service.createFromCareers({
        tenantId,
        jobOpeningId: 'open-1',
        candidateId: 'cand-1',
        resumeUploadId: 'upload-1',
      });

      expect(result).toEqual({ created: true, applicationId: 'new-app' });
      expect(prisma.jobApplication.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ source: 'CAREERS_PAGE', createdById: null }),
        }),
      );
      expect(prisma.jobApplicationStageEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ movedById: null }) }),
      );
    });
  });
});
