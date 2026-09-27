import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../../common/email/email.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { ApproverResolverService } from '../workflow/approver-resolver.service';
import {
  createMockEmailService,
  createMockNotificationsService,
  createMockPrismaService,
  mockHrAdmin,
} from '../../test/helpers';
import { ApplicationsService } from './applications.service';
import { hashPublicToken } from './public-token.util';
import {
  EXPIRY_MARKER,
  OFFER_LINK_INVALID,
  OffersService,
  namesMatch,
} from './offers.service';

const TENANT = 'test-tenant';
const RAW = 'a'.repeat(64);
const FUTURE = new Date(Date.now() + 5 * 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'off-1',
    tenantId: TENANT,
    applicationId: 'app-1',
    candidateId: 'cand-1',
    templateId: 'tpl-1',
    content: `Dear Asha, respond by ${EXPIRY_MARKER}.`,
    designationId: null,
    departmentId: null,
    branchId: null,
    reportingManagerId: null,
    employmentType: 'PERMANENT',
    annualCtc: new Prisma.Decimal(1200000),
    monthlyBasePay: null,
    salaryStructureId: null,
    joiningDate: new Date('2026-04-01T00:00:00Z'),
    expiresAt: null,
    status: 'DRAFT',
    tokenHash: null,
    sentAt: null,
    respondedAt: null,
    acceptedName: null,
    declineReason: null,
    respondedIp: null,
    respondedUserAgent: null,
    decisionNote: null,
    createdById: 'hr-admin-id',
    employeeId: null,
    convertedAt: null,
    createdAt: new Date('2026-03-15T12:00:00Z'),
    updatedAt: new Date('2026-03-15T12:00:00Z'),
    candidate: { id: 'cand-1', firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' },
    application: {
      id: 'app-1',
      status: 'ACTIVE',
      stage: { id: 'st-int', sortOrder: 2, category: 'INTERVIEW' },
      jobOpening: { id: 'open-1', title: 'Backend Engineer' },
    },
    template: { id: 'tpl-1', name: 'Standard offer' },
    designation: null,
    department: null,
    branch: null,
    reportingManager: null,
    salaryStructure: null,
    ...overrides,
  };
}

function publicRow(overrides: Record<string, unknown> = {}) {
  return {
    ...offerRow({ status: 'SENT', expiresAt: FUTURE, tokenHash: hashPublicToken(RAW), content: 'Letter' }),
    tenant: { name: 'Acme', logoUrl: null },
    candidate: { firstName: 'Asha', lastName: 'Rao' },
    application: { status: 'ACTIVE', jobOpening: { title: 'Backend Engineer' } },
    ...overrides,
  };
}

describe('namesMatch', () => {
  it('ignores case and whitespace', () => {
    expect(namesMatch('  asha   RAO ', 'Asha Rao')).toBe(true);
    expect(namesMatch('Asha R', 'Asha Rao')).toBe(false);
    expect(namesMatch('', '')).toBe(false);
  });
});

describe('OffersService', () => {
  let service: OffersService;
  let prisma: any;
  let engine: { start: jest.Mock; act: jest.Mock; cancel: jest.Mock; notifyPending: jest.Mock };
  let applications: { moveToStage: jest.Mock };
  let notifications: ReturnType<typeof createMockNotificationsService>;
  let email: ReturnType<typeof createMockEmailService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();
    engine = {
      start: jest.fn().mockResolvedValue({}),
      act: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
      notifyPending: jest.fn().mockResolvedValue(undefined),
    };
    applications = { moveToStage: jest.fn().mockResolvedValue(undefined) };
    notifications = createMockNotificationsService();
    email = createMockEmailService();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OffersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ApprovalEngineService, useValue: engine },
        { provide: ApplicationsService, useValue: applications },
        { provide: NotificationsService, useValue: notifications },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('https://hr.example') } },
      ],
    }).compile();
    service = moduleRef.get(OffersService);
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Acme', addressLine1: '1 Main St', city: 'Pune' });
  });

  describe('create', () => {
    const dto = {
      templateId: 'tpl-1',
      designationId: 'des-1',
      reportingManagerId: 'emp-mgr',
      annualCtc: 1200000,
      joiningDate: '2026-04-01',
    };

    beforeEach(() => {
      prisma.jobApplication.findFirst.mockResolvedValue({
        id: 'app-1',
        status: 'ACTIVE',
        candidateId: 'cand-1',
        candidate: { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.com' },
        jobOpening: { title: 'Backend Engineer' },
      });
      prisma.letterTemplate.findFirst.mockResolvedValue({
        content: 'Dear {{candidateName}}, {{designation}} at {{companyName}} for ₹{{annualCtc}} from {{joiningDate}} reporting to {{reportingManager}}. Reply by {{expiryDate}}.',
      });
      prisma.designation.findFirst.mockResolvedValue({ name: 'Engineer II' });
      prisma.employee.findFirst.mockResolvedValue({ firstName: 'Mina', lastName: 'Shah' });
      prisma.jobApplication.update.mockResolvedValue({});
      prisma.jobOffer.findFirst.mockResolvedValue(null);
      prisma.jobOffer.create.mockImplementation(async (args: any) => offerRow({ ...args.data }));
    });

    it('renders the OFFER_LETTER template with the offer variables', async () => {
      const view = await service.create(mockHrAdmin, 'app-1', dto);

      expect(prisma.letterTemplate.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tpl-1', tenantId: TENANT, type: 'OFFER_LETTER', isActive: true },
        }),
      );
      const data = prisma.jobOffer.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        tenantId: TENANT,
        applicationId: 'app-1',
        candidateId: 'cand-1',
        status: 'DRAFT',
        createdById: 'hr-admin-id',
        annualCtc: 1200000,
        joiningDate: new Date('2026-04-01T00:00:00.000Z'),
      });
      expect(data.content).toBe(
        `Dear Asha Rao, Engineer II at Acme for ₹12,00,000 from 01 April 2026 reporting to Mina Shah. Reply by ${EXPIRY_MARKER}.`,
      );
      // Until sent, the expiry shows as pending — never the raw marker.
      expect(view.content).toContain('(date set when the offer is sent)');
      expect(view.content).not.toContain(EXPIRY_MARKER);
      expect(view).not.toHaveProperty('tokenHash');
    });

    it('locks the application and 409s when a live offer exists', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue({ id: 'off-old' });
      await expect(service.create(mockHrAdmin, 'app-1', dto)).rejects.toThrow(ConflictException);
      expect(prisma.jobApplication.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'app-1' } }),
      );
      expect(prisma.jobOffer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT,
            applicationId: 'app-1',
            status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SENT'] },
          },
        }),
      );
      expect(prisma.jobOffer.create).not.toHaveBeenCalled();
    });

    it('400s a template that is not an active offer-letter template of the tenant', async () => {
      prisma.letterTemplate.findFirst.mockResolvedValue(null);
      await expect(service.create(mockHrAdmin, 'app-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('400s references from another tenant', async () => {
      prisma.designation.findFirst.mockResolvedValue(null);
      await expect(service.create(mockHrAdmin, 'app-1', dto)).rejects.toThrow(BadRequestException);
      expect(prisma.designation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'des-1', tenantId: TENANT } }),
      );
    });

    it('404s an unknown application and 400s an inactive one', async () => {
      prisma.jobApplication.findFirst.mockResolvedValueOnce(null);
      await expect(service.create(mockHrAdmin, 'app-x', dto)).rejects.toThrow(NotFoundException);
      prisma.jobApplication.findFirst.mockResolvedValueOnce({ id: 'app-1', status: 'WITHDRAWN' });
      await expect(service.create(mockHrAdmin, 'app-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('validates the joining date and a past expiry', async () => {
      await expect(
        service.create(mockHrAdmin, 'app-1', { ...dto, joiningDate: '2026-02-30' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(mockHrAdmin, 'app-1', { ...dto, expiresAt: PAST.toISOString() }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('re-renders a DRAFT offer with a guarded update', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow());
      prisma.letterTemplate.findFirst.mockResolvedValue({ content: 'CTC {{annualCtc}}' });
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });

      await service.update(mockHrAdmin, 'off-1', { annualCtc: 1500000 });

      expect(prisma.jobOffer.updateMany).toHaveBeenCalledWith({
        where: { id: 'off-1', tenantId: TENANT, status: { in: ['DRAFT', 'REJECTED'] } },
        data: expect.objectContaining({ annualCtc: 1500000, content: 'CTC 15,00,000' }),
      });
    });

    it('refuses to edit an offer awaiting approval', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow({ status: 'PENDING_APPROVAL' }));
      await expect(service.update(mockHrAdmin, 'off-1', { annualCtc: 1 })).rejects.toThrow(BadRequestException);
    });
  });

  describe('submit', () => {
    it('moves to PENDING_APPROVAL and starts the OFFER engine in one transaction', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow());
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });

      await service.submit(mockHrAdmin, 'off-1');

      expect(prisma.jobOffer.updateMany).toHaveBeenCalledWith({
        where: { id: 'off-1', tenantId: TENANT, status: { in: ['DRAFT', 'REJECTED'] } },
        data: { status: 'PENDING_APPROVAL', decisionNote: null, submittedById: 'hr-admin-id' },
      });
      expect(engine.start).toHaveBeenCalledWith({
        tenantId: TENANT,
        entityType: 'OFFER',
        entityId: 'off-1',
        context: { requesterEmployeeId: null, requesterUserId: 'hr-admin-id', amount: 1200000 },
        tx: prisma,
      });
      expect(engine.notifyPending).toHaveBeenCalledWith(TENANT, 'OFFER', 'off-1');
    });

    it('makes the submitter the requester, so HR-B cannot approve a draft of HR-A they submitted', async () => {
      // HR-A created the draft; HR-B raised the CTC and submits it.
      const hrB = { ...mockHrAdmin, userId: 'hr-b-id', employeeId: 'emp-hr-b', email: 'hrb@test.com' };
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow({ createdById: 'hr-a-id' }));
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });

      await service.submit(hrB, 'off-1');

      expect(prisma.jobOffer.updateMany.mock.calls[0][0].data.submittedById).toBe('hr-b-id');
      const { context } = engine.start.mock.calls[0][0];
      expect(context.requesterUserId).toBe('hr-b-id');

      // The engine's maker-checker, with allowSelfApproval=false: HR-B is the
      // requester and is blocked even though HR is an eligible approver.
      const resolver = new ApproverResolverService(prisma);
      const instance = { entityType: 'OFFER' as const, ...context, adminOverride: true, allowSelfApproval: false };
      const resolution = { approvers: new Set(['hr-a-id', 'hr-b-id']), onBehalf: new Map<string, string>() };
      expect(resolver.access(hrB, instance, resolution)).toEqual(
        expect.objectContaining({ canAct: false, selfBlocked: true }),
      );
      // HR-A (who did not submit) remains a valid checker.
      const hrA = { ...mockHrAdmin, userId: 'hr-a-id', employeeId: 'emp-hr-a' };
      expect(resolver.access(hrA, instance, resolution).canAct).toBe(true);
    });

    it('routes on the CTC as written by the guarded update, not the pre-read row', async () => {
      // An edit landed between the read and the guarded update.
      prisma.jobOffer.findFirst
        .mockResolvedValueOnce(offerRow())
        .mockResolvedValueOnce({ submittedById: 'hr-admin-id', createdById: 'hr-admin-id', annualCtc: new Prisma.Decimal(5000000) })
        .mockResolvedValue(offerRow({ status: 'PENDING_APPROVAL' }));
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });

      await service.submit(mockHrAdmin, 'off-1');

      expect(engine.start.mock.calls[0][0].context.amount).toBe(5000000);
    });

    it('409s a lost race', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow());
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.submit(mockHrAdmin, 'off-1')).rejects.toThrow(ConflictException);
      expect(engine.start).not.toHaveBeenCalled();
    });
  });

  describe('approve / reject (engine)', () => {
    beforeEach(() => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow({ status: 'PENDING_APPROVAL' }));
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
    });

    it('APPROVED in onFinal on the last step and notifies the creator', async () => {
      engine.act.mockImplementation(async (input: any) => {
        await input.onFinal(prisma);
        return { outcome: 'APPROVED', instanceId: 'i1', nextStepOrder: null };
      });

      await service.approve(mockHrAdmin, 'off-1', 'ok');

      expect(engine.act).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, entityType: 'OFFER', entityId: 'off-1', decision: 'APPROVE' }),
      );
      expect(prisma.jobOffer.updateMany).toHaveBeenCalledWith({
        where: { id: 'off-1', tenantId: TENANT, status: 'PENDING_APPROVAL' },
        data: { status: 'APPROVED', decisionNote: 'ok' },
      });
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'hr-admin-id', type: 'OFFER_APPROVED' }),
      );
    });

    it('stays pending when the chain advances', async () => {
      engine.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'i1', nextStepOrder: 2 });
      await service.approve(mockHrAdmin, 'off-1');
      expect(prisma.jobOffer.updateMany).not.toHaveBeenCalled();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('REJECTED with the note, notifying OFFER_REJECTED', async () => {
      engine.act.mockImplementation(async (input: any) => {
        await input.onFinal(prisma);
        return { outcome: 'REJECTED', instanceId: 'i1', nextStepOrder: null };
      });
      await service.reject(mockHrAdmin, 'off-1', 'too high');
      expect(prisma.jobOffer.updateMany.mock.calls[0][0].data).toEqual({
        status: 'REJECTED',
        decisionNote: 'too high',
      });
      expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'OFFER_REJECTED' }));
    });

    it('400s an offer that is not pending', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow({ status: 'APPROVED' }));
      await expect(service.approve(mockHrAdmin, 'off-1')).rejects.toThrow(BadRequestException);
      expect(engine.act).not.toHaveBeenCalled();
    });
  });

  describe('getWorkflowContext', () => {
    it('is null unless pending, else the submitter and CTC', async () => {
      prisma.jobOffer.findFirst.mockResolvedValueOnce(null);
      await expect(service.getWorkflowContext(TENANT, 'off-1')).resolves.toBeNull();
      prisma.jobOffer.findFirst.mockResolvedValueOnce({
        createdById: 'u1',
        submittedById: 'u2',
        annualCtc: new Prisma.Decimal(900000),
      });
      await expect(service.getWorkflowContext(TENANT, 'off-1')).resolves.toEqual({
        requesterEmployeeId: null,
        requesterUserId: 'u2',
        amount: 900000,
      });
      expect(prisma.jobOffer.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { id: 'off-1', tenantId: TENANT, status: 'PENDING_APPROVAL' } }),
      );
    });
  });

  describe('send', () => {
    beforeEach(() => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow({ status: 'APPROVED' }));
      prisma.recruitmentSettings.findUnique.mockResolvedValue({ offerExpiryDays: 10 });
      prisma.pipelineStage.findFirst.mockResolvedValue({ sortOrder: 3 });
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
    });

    it('stores only the token hash, sets expiry from settings, moves the application and e-mails the link', async () => {
      const before = Date.now();
      await service.send(mockHrAdmin, 'off-1');

      const call = prisma.jobOffer.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'off-1', tenantId: TENANT, status: 'APPROVED' });
      expect(call.data.status).toBe('SENT');
      expect(call.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      const expiresAt: Date = call.data.expiresAt;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 10 * 86_400_000);
      expect(call.data.content).not.toContain(EXPIRY_MARKER);

      expect(applications.moveToStage).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT, applicationId: 'app-1', toCategory: 'OFFER', tx: prisma }),
      );

      const mail = email.sendEmail.mock.calls[0][0] as any;
      expect(mail).toMatchObject({ to: 'asha@example.com', template: 'offer-sent' });
      const raw = mail.context.link.replace('https://hr.example/offer/', '');
      expect(raw).toMatch(/^[a-f0-9]{64}$/);
      // The link carries the raw token; the row only its SHA-256.
      expect(hashPublicToken(raw)).toBe(call.data.tokenHash);
      expect(call.data.tokenHash).not.toBe(raw);
    });

    it('keeps an explicit future expiry and does not move an application already past OFFER', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(
        offerRow({
          status: 'APPROVED',
          expiresAt: FUTURE,
          application: {
            id: 'app-1',
            status: 'ACTIVE',
            stage: { id: 'st-off', sortOrder: 3, category: 'OFFER' },
            jobOpening: { id: 'open-1', title: 'Backend Engineer' },
          },
        }),
      );
      await service.send(mockHrAdmin, 'off-1');
      expect(prisma.jobOffer.updateMany.mock.calls[0][0].data.expiresAt).toEqual(FUTURE);
      expect(applications.moveToStage).not.toHaveBeenCalled();
    });

    it('only sends an APPROVED offer on an ACTIVE application', async () => {
      prisma.jobOffer.findFirst.mockResolvedValueOnce(offerRow({ status: 'DRAFT' }));
      await expect(service.send(mockHrAdmin, 'off-1')).rejects.toThrow(BadRequestException);
      prisma.jobOffer.findFirst.mockResolvedValueOnce(
        offerRow({ status: 'APPROVED', application: { ...offerRow().application, status: 'REJECTED' } }),
      );
      await expect(service.send(mockHrAdmin, 'off-1')).rejects.toThrow(BadRequestException);
      expect(email.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('withdraw', () => {
    it('withdraws a live offer and cancels any pending approval', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow({ status: 'PENDING_APPROVAL' }));
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
      await service.withdraw(mockHrAdmin, 'off-1');
      expect(prisma.jobOffer.updateMany.mock.calls[0][0].data).toEqual({ status: 'WITHDRAWN' });
      expect(engine.cancel).toHaveBeenCalledWith(TENANT, 'OFFER', 'off-1', prisma);
    });

    it('refuses terminal offers', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow({ status: 'ACCEPTED' }));
      await expect(service.withdraw(mockHrAdmin, 'off-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('lazy expiry', () => {
    it('get marks an overdue SENT offer EXPIRED', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow({ status: 'SENT', expiresAt: PAST }));
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
      const view = await service.get(mockHrAdmin, 'off-1');
      expect(view.status).toBe('EXPIRED');
      expect(prisma.jobOffer.updateMany).toHaveBeenCalledWith({
        where: { id: 'off-1', tenantId: TENANT, status: 'SENT' },
        data: { status: 'EXPIRED' },
      });
    });

    it('list expires overdue offers of the tenant first', async () => {
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 0 });
      prisma.jobOffer.findMany.mockResolvedValue([offerRow()]);
      await service.list(mockHrAdmin, { status: 'DRAFT' });
      expect(prisma.jobOffer.updateMany.mock.calls[0][0].where).toMatchObject({ tenantId: TENANT, status: 'SENT' });
      expect(prisma.jobOffer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT, status: 'DRAFT' } }),
      );
    });

    it('get 404s an offer of another tenant', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(null);
      await expect(service.get(mockHrAdmin, 'off-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('pdf', () => {
    it('renders a PDF of the offer', async () => {
      prisma.jobOffer.findFirst.mockResolvedValue(offerRow());
      const { buffer, fileName } = await service.pdf(mockHrAdmin, 'off-1');
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(fileName).toBe('offer-Asha-Rao.pdf');
    });
  });

  describe('public token', () => {
    const meta = { ip: '203.0.113.9', userAgent: 'Mozilla/5.0' };

    it('404s a malformed token without querying', async () => {
      await expect(service.getPublic('not-a-token')).rejects.toThrow(OFFER_LINK_INVALID);
      await expect(service.getPublic('A'.repeat(64))).rejects.toThrow(NotFoundException);
      expect(prisma.jobOffer.findUnique).not.toHaveBeenCalled();
    });

    it('looks the offer up by the hash only', async () => {
      prisma.jobOffer.findUnique.mockResolvedValue(publicRow());
      const view = await service.getPublic(RAW);
      expect(prisma.jobOffer.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashPublicToken(RAW) } }),
      );
      expect(view).toEqual({
        company: { name: 'Acme', logoUrl: null },
        candidateFirstName: 'Asha',
        jobTitle: 'Backend Engineer',
        content: 'Letter',
        annualCtc: 1200000,
        joiningDate: '2026-04-01',
        expiresAt: FUTURE.toISOString(),
        status: 'SENT',
        respondedAt: null,
      });
      // No internal ids or other candidates' data.
      expect(JSON.stringify(view)).not.toMatch(/off-1|app-1|cand-1|hr-admin-id|asha@example.com/);
    });

    it('answers unknown and expired tokens with the same 404', async () => {
      prisma.jobOffer.findUnique.mockResolvedValueOnce(null);
      await expect(service.getPublic(RAW)).rejects.toThrow(OFFER_LINK_INVALID);

      prisma.jobOffer.findUnique.mockResolvedValueOnce(publicRow({ expiresAt: PAST }));
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.getPublic(RAW)).rejects.toThrow(OFFER_LINK_INVALID);
      expect(prisma.jobOffer.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'EXPIRED' } }),
      );
    });

    it('accepts with the typed full name, recording evidence with a guarded update', async () => {
      prisma.jobOffer.findUnique.mockResolvedValue(publicRow());
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findMany.mockResolvedValue([{ id: 'hr-admin-id' }, { id: 'hr-2' }]);

      const view = await service.acceptPublic(RAW, { acceptedName: ' asha  rao ' }, meta);

      const call = prisma.jobOffer.updateMany.mock.calls[0][0];
      expect(call.where).toMatchObject({ id: 'off-1', tenantId: TENANT, status: 'SENT' });
      expect(call.data).toMatchObject({
        status: 'ACCEPTED',
        acceptedName: 'asha  rao',
        respondedIp: '203.0.113.9',
        respondedUserAgent: 'Mozilla/5.0',
      });
      expect(call.data.respondedAt).toBeInstanceOf(Date);
      expect(view.status).toBe('ACCEPTED');
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, isActive: true, OR: [{ role: 'HR_ADMIN' }, { id: 'hr-admin-id' }] },
        }),
      );
      expect(notifications.createMany.mock.calls[0][0]).toHaveLength(2);
      expect(notifications.createMany.mock.calls[0][0][0]).toMatchObject({ type: 'OFFER_ACCEPTED' });
    });

    it('refuses a name that does not match', async () => {
      prisma.jobOffer.findUnique.mockResolvedValue(publicRow());
      await expect(service.acceptPublic(RAW, { acceptedName: 'Someone Else' }, meta)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.jobOffer.updateMany).not.toHaveBeenCalled();
    });

    it('refuses answering an offer that is not SENT', async () => {
      prisma.jobOffer.findUnique.mockResolvedValue(publicRow({ status: 'ACCEPTED' }));
      await expect(service.acceptPublic(RAW, { acceptedName: 'Asha Rao' }, meta)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.declinePublic(RAW, {}, meta)).rejects.toThrow(BadRequestException);
    });

    it('refuses accepting when the application is no longer active', async () => {
      prisma.jobOffer.findUnique.mockResolvedValue(
        publicRow({ application: { status: 'WITHDRAWN', jobOpening: { title: 'X' } } }),
      );
      await expect(service.acceptPublic(RAW, { acceptedName: 'Asha Rao' }, meta)).rejects.toThrow(
        'This offer is no longer available',
      );
    });

    it('409s when answered concurrently', async () => {
      prisma.jobOffer.findUnique.mockResolvedValue(publicRow());
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.acceptPublic(RAW, { acceptedName: 'Asha Rao' }, meta)).rejects.toThrow(
        ConflictException,
      );
    });

    it('declines with an optional reason and truncates the evidence', async () => {
      prisma.jobOffer.findUnique.mockResolvedValue(publicRow());
      prisma.jobOffer.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findMany.mockResolvedValue([{ id: 'hr-admin-id' }]);

      const view = await service.declinePublic(RAW, { reason: ' Accepted elsewhere ' }, {
        ip: 'x'.repeat(100),
        userAgent: 'u'.repeat(500),
      });

      const data = prisma.jobOffer.updateMany.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: 'DECLINED', declineReason: 'Accepted elsewhere' });
      expect(data.respondedIp).toHaveLength(64);
      expect(data.respondedUserAgent).toHaveLength(300);
      expect(view.status).toBe('DECLINED');
      expect(notifications.createMany.mock.calls[0][0][0]).toMatchObject({ type: 'OFFER_DECLINED' });
    });
  });
});
