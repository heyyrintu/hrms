import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMockPrismaService, createMockEmailService, createMockNotificationsService, mockHrAdmin } from '../../test/helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { PreOnboardingService } from './pre-onboarding.service';
import { hashPublicToken } from './public-token.util';
import { DEFAULT_PRE_ONBOARDING_DOCUMENTS } from './recruitment.types';

function pdfFile(): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'doc.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 20,
    buffer: Buffer.from('%PDF-1.4 fake'),
    destination: '',
    filename: '',
    path: '',
    stream: undefined as any,
  } as Express.Multer.File;
}

describe('PreOnboardingService', () => {
  const tenantId = 'test-tenant';
  let prisma: ReturnType<typeof createMockPrismaService>;
  let email: jest.Mocked<EmailService>;
  let notifications: jest.Mocked<NotificationsService>;
  let uploads: { upload: jest.Mock; deleteByAdmin: jest.Mock };
  let service: PreOnboardingService;

  const employeeRow = {
    id: 'emp-1',
    tenantId,
    employeeCode: 'E001',
    firstName: 'Asha',
    lastName: 'Rao',
    email: 'asha@work.test',
    personalEmail: 'asha@personal.test',
    joinDate: new Date('2026-03-15T12:00:00Z'),
  };

  const inviteRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'invite-1',
    tenantId,
    employeeId: 'emp-1',
    offerId: null,
    tokenHash: hashPublicToken('a'.repeat(64)),
    expiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    status: 'INVITED',
    requiredDocuments: [...DEFAULT_PRE_ONBOARDING_DOCUMENTS],
    personalDetails: null,
    submittedAt: null,
    lastAccessedAt: null,
    createdById: mockHrAdmin.userId,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    employee: employeeRow,
    tenant: { id: tenantId, name: 'Acme Inc', logoUrl: null },
    documents: [],
    ...overrides,
  });

  beforeEach(() => {
    prisma = createMockPrismaService();
    email = createMockEmailService();
    notifications = createMockNotificationsService() as any;
    uploads = { upload: jest.fn().mockResolvedValue({ id: 'upload-1' }), deleteByAdmin: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn().mockReturnValue('https://hrms.test') } as unknown as ConfigService;

    service = new PreOnboardingService(
      prisma as unknown as PrismaService,
      config,
      email,
      notifications,
      uploads as unknown as UploadsService,
    );
  });

  describe('create', () => {
    it('404s for an employee outside the tenant', async () => {
      (prisma.employee.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.create(mockHrAdmin, { employeeId: 'emp-1' })).rejects.toThrow(NotFoundException);
    });

    it('409s when the employee already has a live invite', async () => {
      (prisma.employee.findFirst as jest.Mock).mockResolvedValue(employeeRow);
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow());
      await expect(service.create(mockHrAdmin, { employeeId: 'emp-1' })).rejects.toThrow(ConflictException);
    });

    it('creates an invite, emails the personal address, and returns the raw link once', async () => {
      (prisma.employee.findFirst as jest.Mock).mockResolvedValue(employeeRow);
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.preOnboardingInvite.create as jest.Mock).mockResolvedValue(inviteRow());

      const result = await service.create(mockHrAdmin, { employeeId: 'emp-1' });

      expect(result.link).toMatch(/^https:\/\/hrms\.test\/pre-onboarding\/[a-f0-9]{64}$/);
      expect(result.invite.id).toBe('invite-1');
      expect(email.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'asha@personal.test', template: 'pre-onboarding-invite' }),
      );
    });
  });

  describe('create: offer link', () => {
    beforeEach(() => {
      (prisma.employee.findFirst as jest.Mock).mockResolvedValue(employeeRow);
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.preOnboardingInvite.create as jest.Mock).mockResolvedValue(inviteRow({ offerId: 'offer-1' }));
    });

    it('400s an offer that is not in the tenant', async () => {
      (prisma.jobOffer.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.create(mockHrAdmin, { employeeId: 'emp-1', offerId: 'offer-x' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.jobOffer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'offer-x', tenantId } }),
      );
      expect(prisma.preOnboardingInvite.create).not.toHaveBeenCalled();
    });

    it('400s an offer converted to a different employee', async () => {
      (prisma.jobOffer.findFirst as jest.Mock).mockResolvedValue({ id: 'offer-1', employeeId: 'emp-other', preOnboarding: null });
      await expect(service.create(mockHrAdmin, { employeeId: 'emp-1', offerId: 'offer-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('409s an offer that already has an invite (offerId is unique)', async () => {
      (prisma.jobOffer.findFirst as jest.Mock).mockResolvedValue({
        id: 'offer-1',
        employeeId: 'emp-1',
        preOnboarding: { id: 'invite-old' },
      });
      await expect(service.create(mockHrAdmin, { employeeId: 'emp-1', offerId: 'offer-1' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('links an offer of the tenant for the same employee', async () => {
      (prisma.jobOffer.findFirst as jest.Mock).mockResolvedValue({ id: 'offer-1', employeeId: 'emp-1', preOnboarding: null });
      await service.create(mockHrAdmin, { employeeId: 'emp-1', offerId: 'offer-1' });
      expect(prisma.preOnboardingInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ offerId: 'offer-1' }) }),
      );
    });
  });

  describe('revoke / resend / complete', () => {
    it('revoke: 400 when the invite is not live', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow({ status: 'COMPLETED' }));
      await expect(service.revoke(mockHrAdmin, 'invite-1')).rejects.toThrow(BadRequestException);
    });

    it('revoke: sets status REVOKED for a live invite', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow());
      (prisma.preOnboardingInvite.update as jest.Mock).mockResolvedValue(inviteRow({ status: 'REVOKED' }));
      const result = await service.revoke(mockHrAdmin, 'invite-1');
      expect(result.status).toBe('REVOKED');
    });

    it('resend: issues a new token and keeps the old one dead', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow());
      (prisma.recruitmentSettings.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.preOnboardingInvite.update as jest.Mock).mockImplementation(({ data }: any) => inviteRow({ ...data }));

      const result = await service.resend(mockHrAdmin, 'invite-1');
      expect(result.link).toMatch(/^https:\/\/hrms\.test\/pre-onboarding\/[a-f0-9]{64}$/);
      const updateCall = (prisma.preOnboardingInvite.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.tokenHash).not.toBe(hashPublicToken('a'.repeat(64)));
    });

    it('complete: 400 unless the invite is SUBMITTED', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow({ status: 'IN_PROGRESS' }));
      await expect(service.complete(mockHrAdmin, 'invite-1')).rejects.toThrow(BadRequestException);
    });

    it('complete: SUBMITTED -> COMPLETED', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow({ status: 'SUBMITTED' }));
      (prisma.preOnboardingInvite.update as jest.Mock).mockResolvedValue(inviteRow({ status: 'COMPLETED' }));
      const result = await service.complete(mockHrAdmin, 'invite-1');
      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('public portal', () => {
    const rawToken = 'a'.repeat(64);

    it('404s the same message for a malformed token (no query issued)', async () => {
      await expect(service.getPublic('not-a-token')).rejects.toThrow('This pre-onboarding link is invalid or has expired');
      expect(prisma.preOnboardingInvite.findFirst).not.toHaveBeenCalled();
    });

    it('404s the same message for an unknown token', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(null);
      await expect(service.getPublic(rawToken)).rejects.toThrow('This pre-onboarding link is invalid or has expired');
    });

    it('404s the same message for a COMPLETED invite, so personal data stops being served', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(
        inviteRow({ status: 'COMPLETED', personalDetails: { mobileNumber: '999' } }),
      );
      await expect(service.getPublic(rawToken)).rejects.toThrow('This pre-onboarding link is invalid or has expired');
      expect(prisma.preOnboardingInvite.update).not.toHaveBeenCalled();
    });

    it('404s the same message for a revoked token', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow({ status: 'REVOKED' }));
      await expect(service.getPublic(rawToken)).rejects.toThrow('This pre-onboarding link is invalid or has expired');
    });

    it('lazily expires and 404s once past expiresAt', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(
        inviteRow({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.getPublic(rawToken)).rejects.toThrow('This pre-onboarding link is invalid or has expired');
      expect(prisma.preOnboardingInvite.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRED' } }),
      );
    });

    it('getPublic touches lastAccessedAt and returns the checklist without internal fields', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow());
      (prisma.preOnboardingInvite.update as jest.Mock).mockResolvedValue(inviteRow());

      const result = await service.getPublic(rawToken);

      expect(prisma.preOnboardingInvite.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { lastAccessedAt: expect.any(Date) } }),
      );
      expect(result.employeeFirstName).toBe('Asha');
      expect(result.documents[0]).not.toHaveProperty('verified');
      expect(result.documents[0]).not.toHaveProperty('category');
    });

    it('saveDetailsPublic writes whitelisted fields to Employee and mirrors personalDetails', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock)
        .mockResolvedValueOnce(inviteRow())
        .mockResolvedValueOnce(inviteRow({ personalDetails: { mobileNumber: '9999999999' } }));
      (prisma.$transaction as jest.Mock).mockResolvedValue([{}, {}]);

      await service.saveDetailsPublic(rawToken, { mobileNumber: '9999999999' });

      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { mobileNumber: '9999999999' },
      });
    });

    it('saveDetailsPublic is locked after submission', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow({ status: 'SUBMITTED' }));
      await expect(service.saveDetailsPublic(rawToken, { mobileNumber: '1' })).rejects.toThrow(BadRequestException);
    });

    it('uploadDocumentPublic rejects an unknown document key', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow());
      await expect(service.uploadDocumentPublic(rawToken, 'not_a_real_key', pdfFile())).rejects.toThrow(
        BadRequestException,
      );
    });

    it('uploadDocumentPublic rejects a spoofed file', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow());
      const badFile = { ...pdfFile(), buffer: Buffer.from([0x00, 0x00]) };
      await expect(service.uploadDocumentPublic(rawToken, 'photo_id', badFile)).rejects.toThrow(BadRequestException);
    });

    it('uploadDocumentPublic stores a new document and flips status to IN_PROGRESS', async () => {
      const savedDoc = {
        documentKey: 'photo_id',
        uploadedAt: new Date('2026-01-02T12:00:00Z'),
        employeeDocument: { isVerified: false, upload: { fileName: 'doc.pdf' } },
      };
      (prisma.preOnboardingInvite.findFirst as jest.Mock)
        .mockResolvedValueOnce(inviteRow())
        .mockResolvedValueOnce(inviteRow({ status: 'IN_PROGRESS', documents: [savedDoc] }));
      (prisma.employeeDocument.create as jest.Mock).mockResolvedValue({ id: 'edoc-1' });
      (prisma.preOnboardingDocument.create as jest.Mock).mockResolvedValue({ id: 'pod-1' });

      await service.uploadDocumentPublic(rawToken, 'photo_id', pdfFile());

      expect(uploads.upload).toHaveBeenCalledWith(expect.anything(), tenantId, 'public:pre-onboarding', 'PRE_ONBOARDING', 'invite-1');
      expect(prisma.preOnboardingDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ inviteId: 'invite-1', documentKey: 'photo_id' }) }),
      );
      expect(prisma.preOnboardingInvite.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'IN_PROGRESS' } }),
      );
    });

    it('uploadDocumentPublic replaces an existing document (deletes the old upload)', async () => {
      const existingDoc = {
        id: 'pod-1',
        documentKey: 'photo_id',
        employeeDocumentId: 'edoc-old',
        uploadedAt: new Date('2026-01-02T12:00:00Z'),
        employeeDocument: { upload: { key: 'PRE_ONBOARDING/old.pdf', fileName: 'old.pdf' }, isVerified: false },
      };
      (prisma.preOnboardingInvite.findFirst as jest.Mock)
        .mockResolvedValueOnce(inviteRow({ status: 'IN_PROGRESS', documents: [existingDoc] }))
        .mockResolvedValueOnce(inviteRow({ status: 'IN_PROGRESS', documents: [existingDoc] }));
      (prisma.employeeDocument.create as jest.Mock).mockResolvedValue({ id: 'edoc-new' });
      (prisma.employeeDocument.delete as jest.Mock).mockResolvedValue({});
      (prisma.preOnboardingDocument.update as jest.Mock).mockResolvedValue({});

      await service.uploadDocumentPublic(rawToken, 'photo_id', pdfFile());

      expect(prisma.preOnboardingDocument.update).toHaveBeenCalledWith({
        where: { id: 'pod-1' },
        data: { employeeDocumentId: 'edoc-new', uploadedAt: expect.any(Date) },
      });
      expect(prisma.employeeDocument.delete).toHaveBeenCalledWith({ where: { id: 'edoc-old' } });
      expect(uploads.deleteByAdmin).toHaveBeenCalledWith('PRE_ONBOARDING/old.pdf', tenantId);
    });

    it('submitPublic 400s when a required document is missing', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow({ documents: [] }));
      await expect(service.submitPublic(rawToken)).rejects.toThrow(BadRequestException);
    });

    it('submitPublic succeeds once every required document is uploaded and notifies HR', async () => {
      const requiredKeys = DEFAULT_PRE_ONBOARDING_DOCUMENTS.filter((d) => d.required).map((d) => ({ documentKey: d.key }));
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow({ documents: requiredKeys }));
      (prisma.preOnboardingInvite.update as jest.Mock).mockResolvedValue(inviteRow({ status: 'SUBMITTED' }));

      const result = await service.submitPublic(rawToken);
      expect(result.status).toBe('SUBMITTED');
      expect(notifications.notifyByRole).toHaveBeenCalled();
    });

    it('submitPublic is locked once already SUBMITTED', async () => {
      (prisma.preOnboardingInvite.findFirst as jest.Mock).mockResolvedValue(inviteRow({ status: 'SUBMITTED' }));
      await expect(service.submitPublic(rawToken)).rejects.toThrow(BadRequestException);
    });
  });
});
