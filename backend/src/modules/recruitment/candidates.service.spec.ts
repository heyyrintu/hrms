import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CandidatesService } from './candidates.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService, mockHrAdmin } from '../../test/helpers';

describe('CandidatesService', () => {
  let service: CandidatesService;
  let prisma: any;

  const tenantId = mockHrAdmin.tenantId;

  const candidateRow = {
    id: 'cand-1',
    tenantId,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: null,
    currentCompany: null,
    currentTitle: null,
    totalExperienceYears: null,
    currentCtc: null,
    expectedCtc: null,
    noticePeriodDays: null,
    location: null,
    linkedinUrl: null,
    source: 'DIRECT',
    referredByEmployeeId: null,
    resumeUploadId: null,
    notes: null,
    createdById: mockHrAdmin.userId,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z'),
    referredBy: null,
    resumeUpload: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CandidatesService, { provide: PrismaService, useValue: createMockPrismaService() }],
    }).compile();
    service = module.get(CandidatesService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('lower-cases and trims the email before checking for a duplicate', async () => {
      prisma.candidate.findUnique.mockResolvedValue(null);
      prisma.candidate.create.mockResolvedValue(candidateRow);

      await service.create(mockHrAdmin, {
        firstName: 'Jane',
        lastName: 'Doe',
        email: ' Jane@Example.com ',
      });

      expect(prisma.candidate.findUnique).toHaveBeenCalledWith({
        where: { tenantId_email: { tenantId, email: 'jane@example.com' } },
      });
      expect(prisma.candidate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'jane@example.com' }) }),
      );
    });

    it('409s with the existing candidate id on a duplicate email', async () => {
      prisma.candidate.findUnique.mockResolvedValue(candidateRow);

      await expect(
        service.create(mockHrAdmin, { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ existingCandidateId: 'cand-1' }),
      });
      await expect(
        service.create(mockHrAdmin, { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a referring employee outside the tenant', async () => {
      prisma.candidate.findUnique.mockResolvedValue(null);
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockHrAdmin, {
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          referredByEmployeeId: 'other-tenant-emp',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('get', () => {
    it('404s for a candidate of another tenant', async () => {
      prisma.candidate.findFirst.mockResolvedValue(null);
      await expect(service.get(mockHrAdmin, 'cand-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('includes application history', async () => {
      prisma.candidate.findFirst.mockResolvedValue(candidateRow);
      prisma.jobApplication.findMany.mockResolvedValue([
        {
          id: 'app-1',
          jobOpening: { id: 'open-1', title: 'Engineer' },
          stage: { id: 'stage-1', name: 'Applied', sortOrder: 1, category: 'APPLIED', isActive: true },
          status: 'ACTIVE',
          appliedAt: new Date('2026-01-02T12:00:00Z'),
        },
      ]);

      const result = await service.get(mockHrAdmin, 'cand-1');

      expect(result.applications).toHaveLength(1);
      expect(result.applications[0].jobOpening).toEqual({ id: 'open-1', title: 'Engineer' });
    });
  });

  describe('findOrCreateForCareers', () => {
    it('creates a new candidate with source CAREERS_PAGE when none exists', async () => {
      prisma.candidate.findUnique.mockResolvedValue(null);
      prisma.candidate.create.mockResolvedValue({ id: 'new-cand' });

      const result = await service.findOrCreateForCareers({
        tenantId,
        firstName: 'Amy',
        lastName: 'Lee',
        email: 'amy@example.com',
      });

      expect(result).toEqual({ candidateId: 'new-cand', created: true });
      expect(prisma.candidate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ source: 'CAREERS_PAGE' }) }),
      );
    });

    it('fills only empty fields on an existing candidate, never overwriting data', async () => {
      prisma.candidate.findUnique.mockResolvedValue({
        ...candidateRow,
        phone: '9999999999',
        currentCompany: null,
      });
      prisma.candidate.update.mockResolvedValue({});

      const result = await service.findOrCreateForCareers({
        tenantId,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '1111111111',
        currentCompany: 'Acme',
      });

      expect(result).toEqual({ candidateId: 'cand-1', created: false });
      expect(prisma.candidate.update).toHaveBeenCalledWith({
        where: { id: 'cand-1' },
        data: { currentCompany: 'Acme' },
      });
    });

    it('does not write when nothing is missing', async () => {
      prisma.candidate.findUnique.mockResolvedValue({
        ...candidateRow,
        phone: '9999999999',
        currentCompany: 'Existing Co',
      });

      await service.findOrCreateForCareers({
        tenantId,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '1111111111',
        currentCompany: 'Acme',
      });

      expect(prisma.candidate.update).not.toHaveBeenCalled();
    });
  });
});
