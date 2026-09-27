import { NotFoundException } from '@nestjs/common';
import { createMockPrismaService, createMockNotificationsService } from '../../test/helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { CandidatesService } from './candidates.service';
import { ApplicationsService } from './applications.service';
import { PublicCareersService } from './public-careers.service';

function pdfFile(): Express.Multer.File {
  return {
    fieldname: 'resume',
    originalname: 'resume.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 20,
    buffer: Buffer.from('%PDF-1.4 fake resume'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as any,
  } as Express.Multer.File;
}

describe('PublicCareersService', () => {
  const tenantId = 'tenant-1';
  let prisma: ReturnType<typeof createMockPrismaService>;
  let notifications: jest.Mocked<NotificationsService>;
  let uploads: { upload: jest.Mock };
  let candidates: { findOrCreateForCareers: jest.Mock };
  let applications: { createFromCareers: jest.Mock };
  let service: PublicCareersService;

  const activeTenant = { id: tenantId, code: 'acme', isActive: true, name: 'Acme Inc', logoUrl: null, website: null, description: null };

  beforeEach(() => {
    prisma = createMockPrismaService();
    notifications = createMockNotificationsService() as any;
    uploads = { upload: jest.fn().mockResolvedValue({ id: 'upload-1' }) };
    candidates = { findOrCreateForCareers: jest.fn().mockResolvedValue({ candidateId: 'cand-1', created: true }) };
    applications = { createFromCareers: jest.fn().mockResolvedValue({ created: true, applicationId: 'app-1' }) };

    service = new PublicCareersService(
      prisma as unknown as PrismaService,
      notifications,
      uploads as unknown as UploadsService,
      candidates as unknown as CandidatesService,
      applications as unknown as ApplicationsService,
    );
  });

  describe('getCareers', () => {
    it('404s with the same message for an unknown tenant code', async () => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getCareers('nope')).rejects.toThrow(NotFoundException);
      await expect(service.getCareers('nope')).rejects.toThrow('Careers page not found');
    });

    it('404s with the same message for an inactive tenant', async () => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({ ...activeTenant, isActive: false });
      await expect(service.getCareers('acme')).rejects.toThrow('Careers page not found');
    });

    it('404s with the same message when the careers page is disabled', async () => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(activeTenant);
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue({ careersPageEnabled: false });
      await expect(service.getCareers('acme')).rejects.toThrow('Careers page not found');
    });

    it('lists only OPEN, public openings and never internal fields', async () => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(activeTenant);
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue({ careersPageEnabled: true, careersIntro: 'Join us' });
      (prisma.jobOpening.findMany as jest.Mock).mockResolvedValue([
        {
          slug: 'swe-1',
          title: 'Software Engineer',
          location: 'Remote',
          department: { name: 'Engineering' },
          employmentType: 'PERMANENT',
          experienceMin: 1,
          experienceMax: 3,
          publishedAt: new Date('2026-01-01T12:00:00Z'),
        },
      ]);

      const result = await service.getCareers('acme');

      expect(prisma.jobOpening.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'OPEN', isPublic: true } }),
      );
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0]).toEqual({
        slug: 'swe-1',
        title: 'Software Engineer',
        location: 'Remote',
        department: 'Engineering',
        employmentType: 'PERMANENT',
        experienceMin: 1,
        experienceMax: 3,
        publishedAt: '2026-01-01T12:00:00.000Z',
      });
      expect(result.jobs[0]).not.toHaveProperty('salaryMin');
      expect(result.company.careersIntro).toBe('Join us');
    });
  });

  describe('getJob', () => {
    beforeEach(() => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(activeTenant);
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue({ careersPageEnabled: true });
    });

    it('404s the same message for a missing/unpublished job', async () => {
      (prisma.jobOpening.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getJob('acme', 'missing')).rejects.toThrow('Careers page not found');
    });

    it('hides salary when showSalary is false', async () => {
      (prisma.jobOpening.findFirst as jest.Mock).mockResolvedValue({
        slug: 'swe-1',
        title: 'SWE',
        location: null,
        department: null,
        employmentType: 'PERMANENT',
        experienceMin: null,
        experienceMax: null,
        publishedAt: null,
        description: 'desc',
        requirements: null,
        showSalary: false,
        salaryMin: 1000000,
        salaryMax: 2000000,
      });
      const result = await service.getJob('acme', 'swe-1');
      expect(result.salaryMin).toBeNull();
      expect(result.salaryMax).toBeNull();
    });

    it('shows salary when showSalary is true', async () => {
      (prisma.jobOpening.findFirst as jest.Mock).mockResolvedValue({
        slug: 'swe-1',
        title: 'SWE',
        location: null,
        department: null,
        employmentType: 'PERMANENT',
        experienceMin: null,
        experienceMax: null,
        publishedAt: null,
        description: 'desc',
        requirements: null,
        showSalary: true,
        salaryMin: 1000000,
        salaryMax: 2000000,
      });
      const result = await service.getJob('acme', 'swe-1');
      expect(result.salaryMin).toBe(1000000);
      expect(result.salaryMax).toBe(2000000);
    });
  });

  describe('apply', () => {
    const openingRow = { id: 'opening-1', title: 'SWE' };

    beforeEach(() => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(activeTenant);
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue({ careersPageEnabled: true });
      (prisma.jobOpening.findFirst as jest.Mock).mockResolvedValue(openingRow);
      (prisma.candidate.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    });

    const baseInput = { firstName: 'A', lastName: 'B', email: 'a@b.com' };

    it('rejects silently (404) when the honeypot field is filled', async () => {
      await expect(
        service.apply('acme', 'swe-1', { ...baseInput, website: 'http://spam.example' }, pdfFile()),
      ).rejects.toThrow('Careers page not found');
      expect(candidates.findOrCreateForCareers).not.toHaveBeenCalled();
    });

    it('404s for a missing/unpublished opening', async () => {
      (prisma.jobOpening.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.apply('acme', 'missing', baseInput, pdfFile())).rejects.toThrow('Careers page not found');
    });

    it('rejects a spoofed resume file before touching the candidate/application', async () => {
      const badFile = { ...pdfFile(), buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]) };
      await expect(service.apply('acme', 'swe-1', baseInput, badFile)).rejects.toThrow(/does not look like/);
      expect(candidates.findOrCreateForCareers).not.toHaveBeenCalled();
    });

    it('creates the candidate, uploads the resume, creates the application, and notifies HR on a new application', async () => {
      const result = await service.apply('acme', 'swe-1', baseInput, pdfFile());

      expect(result).toEqual({ message: 'Application received' });
      expect(candidates.findOrCreateForCareers).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId, email: 'a@b.com' }),
      );
      expect(uploads.upload).toHaveBeenCalledWith(expect.anything(), tenantId, 'public:careers', 'CANDIDATE_RESUME', 'cand-1');
      expect(prisma.candidate.updateMany).toHaveBeenCalledWith({
        where: { id: 'cand-1', tenantId, resumeUploadId: null },
        data: { resumeUploadId: 'upload-1' },
      });
      expect(applications.createFromCareers).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId, jobOpeningId: 'opening-1', candidateId: 'cand-1', resumeUploadId: 'upload-1' }),
      );
      expect(notifications.notifyByRole).toHaveBeenCalled();
    });

    it('returns the same success body for a duplicate application and does not leak existence', async () => {
      applications.createFromCareers.mockResolvedValue({ created: false, applicationId: 'app-1' });
      const result = await service.apply('acme', 'swe-1', baseInput, pdfFile());
      expect(result).toEqual({ message: 'Application received' });
    });
  });
});
