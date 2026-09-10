import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { ProofsService } from './proofs.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const EMPLOYEE = 'emp-1';
const OTHER_EMPLOYEE = 'emp-2';
const USER = 'user-1';
const OTHER_USER = 'user-2';
const REVIEWER = 'reviewer-1';
const FY = 2026;

function notFoundError() {
  return new Prisma.PrismaClientKnownRequestError('Record to update not found', {
    code: 'P2025',
    clientVersion: '6.0.0',
  });
}

function makeUpload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upload-1',
    tenantId: TENANT,
    key: 'proofs/abc.pdf',
    fileName: '80c-receipt.pdf',
    mimeType: 'application/pdf',
    size: 1024,
    uploadedBy: USER,
    ...overrides,
  };
}

function makeProof(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proof-1',
    tenantId: TENANT,
    employeeId: EMPLOYEE,
    financialYear: FY,
    section: 'SECTION_80C',
    status: 'PENDING',
    claimedAmount: new Decimal('50000'),
    verifiedAmount: null,
    uploadId: 'upload-1',
    description: 'ELSS statement',
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    ...overrides,
  };
}

function submitDto(overrides: Record<string, unknown> = {}) {
  return {
    financialYear: FY,
    section: 'SECTION_80C',
    claimedAmount: 50000,
    uploadId: 'upload-1',
    description: 'ELSS statement',
    ...overrides,
  } as never;
}

describe('ProofsService', () => {
  let service: ProofsService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    prisma = createMockPrismaService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProofsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ProofsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Submitting
  // -------------------------------------------------------------------------

  describe('submit', () => {
    it('files a PENDING proof against the caller own employee record', async () => {
      (prisma.upload.findFirst as jest.Mock).mockResolvedValue(makeUpload());
      (prisma.investmentProof.create as jest.Mock).mockResolvedValue(makeProof());

      await service.submit(TENANT, EMPLOYEE, USER, submitDto());

      const arg = (prisma.investmentProof.create as jest.Mock).mock.calls[0][0];
      expect(arg.data).toMatchObject({
        tenantId: TENANT,
        employeeId: EMPLOYEE,
        financialYear: FY,
        section: 'SECTION_80C',
        status: 'PENDING',
        uploadId: 'upload-1',
      });
      expect(arg.data.claimedAmount).toBeInstanceOf(Decimal);
      expect(arg.data.claimedAmount.toFixed(2)).toBe('50000.00');
      // Nothing is verified at submission time.
      expect(arg.data.verifiedAmount).toBeUndefined();
    });

    it('looks the upload up within the caller own tenant', async () => {
      (prisma.upload.findFirst as jest.Mock).mockResolvedValue(makeUpload());
      (prisma.investmentProof.create as jest.Mock).mockResolvedValue(makeProof());

      await service.submit(TENANT, EMPLOYEE, USER, submitDto());

      expect(prisma.upload.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'upload-1', tenantId: TENANT }),
        }),
      );
    });

    it('refuses a document uploaded by somebody else', async () => {
      (prisma.upload.findFirst as jest.Mock).mockResolvedValue(
        makeUpload({ uploadedBy: OTHER_USER }),
      );

      await expect(
        service.submit(TENANT, EMPLOYEE, USER, submitDto()),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.investmentProof.create).not.toHaveBeenCalled();
    });

    it('refuses an upload that is not in this tenant', async () => {
      // The lookup is tenant-scoped, so a cross-tenant id is indistinguishable
      // from one that never existed.
      (prisma.upload.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.submit(OTHER_TENANT, EMPLOYEE, USER, submitDto()),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.investmentProof.create).not.toHaveBeenCalled();
    });

    it('refuses a claim of nothing', async () => {
      (prisma.upload.findFirst as jest.Mock).mockResolvedValue(makeUpload());

      await expect(
        service.submit(TENANT, EMPLOYEE, USER, submitDto({ claimedAmount: 0 })),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.investmentProof.create).not.toHaveBeenCalled();
    });

    it('refuses an account with no employee record before running any query', async () => {
      await expect(
        service.submit(TENANT, undefined, USER, submitDto()),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.upload.findFirst).not.toHaveBeenCalled();
      expect(prisma.investmentProof.create).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Reading your own
  // -------------------------------------------------------------------------

  describe('listMine', () => {
    it('scopes to the caller own tenant, employee and year', async () => {
      (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue([]);

      await service.listMine(TENANT, EMPLOYEE, FY);

      expect(prisma.investmentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, employeeId: EMPLOYEE, financialYear: FY },
        }),
      );
    });

    it('refuses an account with no employee record before running any query', async () => {
      await expect(service.listMine(TENANT, undefined, FY)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.investmentProof.findMany).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Withdrawing
  // -------------------------------------------------------------------------

  describe('withdraw', () => {
    it('withdraws a pending proof under a status guard', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());
      (prisma.investmentProof.delete as jest.Mock).mockResolvedValue(makeProof());

      await service.withdraw(TENANT, EMPLOYEE, 'proof-1');

      expect(prisma.investmentProof.delete).toHaveBeenCalledWith({
        where: {
          id: 'proof-1',
          tenantId: TENANT,
          employeeId: EMPLOYEE,
          status: 'PENDING',
        },
      });
    });

    it('cannot reach the proof of another employee, and says only that it is not found', async () => {
      // The lookup is scoped to the caller, so a colleague's proof returns
      // nothing: a probe cannot tell "someone else's" from "does not exist".
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.withdraw(TENANT, OTHER_EMPLOYEE, 'proof-1'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.investmentProof.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: OTHER_EMPLOYEE,
            tenantId: TENANT,
          }),
        }),
      );
      expect(prisma.investmentProof.delete).not.toHaveBeenCalled();
    });

    it('refuses to withdraw a proof that has already been reviewed', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(
        makeProof({ status: 'APPROVED' }),
      );

      await expect(service.withdraw(TENANT, EMPLOYEE, 'proof-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.investmentProof.delete).not.toHaveBeenCalled();
    });

    it('turns a lost race into a conflict rather than a crash', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());
      (prisma.investmentProof.delete as jest.Mock).mockRejectedValue(notFoundError());

      await expect(service.withdraw(TENANT, EMPLOYEE, 'proof-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses an account with no employee record before running any query', async () => {
      await expect(service.withdraw(TENANT, undefined, 'proof-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.investmentProof.findFirst).not.toHaveBeenCalled();
      expect(prisma.investmentProof.delete).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // The document itself
  // -------------------------------------------------------------------------

  describe('fileFor', () => {
    it('scopes an employee to their own proof', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue({
        ...makeProof(),
        upload: makeUpload(),
      });

      const upload = await service.fileFor(TENANT, 'proof-1', {
        employeeId: EMPLOYEE,
        isPayrollStaff: false,
      });

      expect(prisma.investmentProof.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proof-1', tenantId: TENANT, employeeId: EMPLOYEE },
        }),
      );
      expect((upload as { key: string }).key).toBe('proofs/abc.pdf');
    });

    it('lets payroll staff read any proof in their own tenant', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue({
        ...makeProof(),
        upload: makeUpload(),
      });

      await service.fileFor(TENANT, 'proof-1', {
        employeeId: 'emp-hr',
        isPayrollStaff: true,
      });

      expect(prisma.investmentProof.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proof-1', tenantId: TENANT },
        }),
      );
    });

    it('reports a proof it cannot reach as not found', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.fileFor(TENANT, 'proof-1', {
          employeeId: OTHER_EMPLOYEE,
          isPayrollStaff: false,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses an account with no employee record before running any query', async () => {
      await expect(
        service.fileFor(TENANT, 'proof-1', { isPayrollStaff: false }),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.investmentProof.findFirst).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Review queue
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('scopes the queue to the caller tenant and applies the filters given', async () => {
      (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(TENANT, {
        financialYear: FY,
        status: 'PENDING',
        employeeId: EMPLOYEE,
      } as never);

      expect(prisma.investmentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT,
            financialYear: FY,
            status: 'PENDING',
            employeeId: EMPLOYEE,
          },
        }),
      );
    });

    it('omits filters that were not given', async () => {
      (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue([]);

      await service.list(TENANT, {});

      expect(prisma.investmentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: TENANT } }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Approving
  // -------------------------------------------------------------------------

  describe('approve', () => {
    it('records the verified amount, the reviewer and the moment', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());
      (prisma.investmentProof.update as jest.Mock).mockResolvedValue(makeProof());

      await service.approve(TENANT, REVIEWER, 'proof-1', { verifiedAmount: 40000 });

      const arg = (prisma.investmentProof.update as jest.Mock).mock.calls[0][0];
      expect(arg.where).toEqual({
        id: 'proof-1',
        tenantId: TENANT,
        status: 'PENDING',
      });
      expect(arg.data.status).toBe('APPROVED');
      expect(arg.data.verifiedAmount).toBeInstanceOf(Decimal);
      expect(arg.data.verifiedAmount.toFixed(2)).toBe('40000.00');
      expect(arg.data.reviewedBy).toBe(REVIEWER);
      expect(arg.data.reviewedAt).toBeInstanceOf(Date);
    });

    it('allows verifying exactly what was claimed', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());
      (prisma.investmentProof.update as jest.Mock).mockResolvedValue(makeProof());

      await service.approve(TENANT, REVIEWER, 'proof-1', { verifiedAmount: 50000 });

      expect(prisma.investmentProof.update).toHaveBeenCalled();
    });

    it('refuses to verify more than the employee claimed', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());

      await expect(
        service.approve(TENANT, REVIEWER, 'proof-1', { verifiedAmount: 50000.01 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.investmentProof.update).not.toHaveBeenCalled();
    });

    it('refuses a proof that has already been decided', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(
        makeProof({ status: 'REJECTED' }),
      );

      await expect(
        service.approve(TENANT, REVIEWER, 'proof-1', { verifiedAmount: 100 }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.investmentProof.update).not.toHaveBeenCalled();
    });

    it('lets the second of two simultaneous reviewers lose with a conflict', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());
      (prisma.investmentProof.update as jest.Mock).mockRejectedValue(notFoundError());

      await expect(
        service.approve(TENANT, REVIEWER, 'proof-1', { verifiedAmount: 100 }),
      ).rejects.toThrow(ConflictException);
    });

    it('reports a missing proof as not found', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.approve(TENANT, REVIEWER, 'nope', { verifiedAmount: 100 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('looks the proof up within the caller tenant only', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());
      (prisma.investmentProof.update as jest.Mock).mockResolvedValue(makeProof());

      await service.approve(TENANT, REVIEWER, 'proof-1', { verifiedAmount: 1 });

      expect(prisma.investmentProof.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proof-1', tenantId: TENANT },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Rejecting
  // -------------------------------------------------------------------------

  describe('reject', () => {
    it('refuses a rejection with no reason, before running any query', async () => {
      await expect(
        service.reject(TENANT, REVIEWER, 'proof-1', { reviewNote: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.investmentProof.findFirst).not.toHaveBeenCalled();
      expect(prisma.investmentProof.update).not.toHaveBeenCalled();
    });

    it('stores the reason and no verified amount', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());
      (prisma.investmentProof.update as jest.Mock).mockResolvedValue(makeProof());

      await service.reject(TENANT, REVIEWER, 'proof-1', {
        reviewNote: 'The receipt is dated outside this financial year',
      });

      const arg = (prisma.investmentProof.update as jest.Mock).mock.calls[0][0];
      expect(arg.where).toEqual({
        id: 'proof-1',
        tenantId: TENANT,
        status: 'PENDING',
      });
      expect(arg.data.status).toBe('REJECTED');
      expect(arg.data.verifiedAmount).toBeNull();
      expect(arg.data.reviewNote).toBe(
        'The receipt is dated outside this financial year',
      );
      expect(arg.data.reviewedBy).toBe(REVIEWER);
    });

    it('refuses a proof that has already been decided', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(
        makeProof({ status: 'APPROVED' }),
      );

      await expect(
        service.reject(TENANT, REVIEWER, 'proof-1', { reviewNote: 'no' }),
      ).rejects.toThrow(ConflictException);
    });

    it('lets the second of two simultaneous reviewers lose with a conflict', async () => {
      (prisma.investmentProof.findFirst as jest.Mock).mockResolvedValue(makeProof());
      (prisma.investmentProof.update as jest.Mock).mockRejectedValue(notFoundError());

      await expect(
        service.reject(TENANT, REVIEWER, 'proof-1', { reviewNote: 'illegible' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------

  describe('summary', () => {
    function arrange(options: {
      declaration?: Record<string, unknown> | null;
      config?: Record<string, unknown> | null;
      proofs?: Record<string, unknown>[];
    }) {
      (prisma.employeeTaxDeclaration.findFirst as jest.Mock).mockResolvedValue(
        options.declaration === undefined
          ? { section80C: new Decimal('150000'), section80D: new Decimal('25000') }
          : options.declaration,
      );
      (prisma.statutoryConfig.findUnique as jest.Mock).mockResolvedValue(
        options.config === undefined
          ? { proofVerificationRequired: true, proofCutoffMonth: 1 }
          : options.config,
      );
      (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue(
        options.proofs ?? [],
      );
    }

    it('reports declared, claimed and approved side by side for each head', async () => {
      arrange({
        proofs: [
          makeProof({
            status: 'APPROVED',
            claimedAmount: new Decimal('50000'),
            verifiedAmount: new Decimal('45000'),
          }),
          makeProof({ id: 'p2', status: 'PENDING', claimedAmount: new Decimal('30000') }),
          makeProof({ id: 'p3', status: 'REJECTED', claimedAmount: new Decimal('9999') }),
        ],
      });

      const result = await service.summary(TENANT, EMPLOYEE, FY);
      const row = result.rows.find((r) => r.section === 'SECTION_80C');

      expect(row).toEqual({
        section: 'SECTION_80C',
        declared: '150000.00',
        claimed: '80000.00',
        approved: '45000.00',
        pendingCount: 1,
        rejectedCount: 1,
      });
    });

    it('carries the year and the declared figure of every other head too', async () => {
      arrange({ proofs: [] });

      const result = await service.summary(TENANT, EMPLOYEE, FY);

      expect(result.financialYear).toBe(FY);
      expect(result.rows.find((r) => r.section === 'SECTION_80D')?.declared).toBe(
        '25000.00',
      );
    });

    it('shows zero declared when the employee has filed no declaration', async () => {
      arrange({ declaration: null, proofs: [] });

      const result = await service.summary(TENANT, EMPLOYEE, FY);

      expect(result.rows.every((r) => r.declared === '0.00')).toBe(true);
      expect(result.rows.every((r) => r.claimed === '0.00')).toBe(true);
      expect(result.rows.every((r) => r.approved === '0.00')).toBe(true);
    });

    it('covers every proof head, in the order of the contract', async () => {
      arrange({ proofs: [] });

      const result = await service.summary(TENANT, EMPLOYEE, FY);

      expect(result.rows.map((r) => r.section)).toEqual([
        'SECTION_80C',
        'SECTION_80D',
        'SECTION_80CCD1B',
        'HRA',
        'HOME_LOAN_INTEREST',
        'OTHER_DEDUCTIONS',
        'PREVIOUS_EMPLOYER_TDS',
      ]);
    });

    it('reports verification as out of force when the tenant has not opted in', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-02-10T12:00:00Z'));
      arrange({ config: { proofVerificationRequired: false, proofCutoffMonth: 1 } });

      const result = await service.summary(TENANT, EMPLOYEE, FY);

      expect(result.verificationInForce).toBe(false);
      expect(result.cutoffMonth).toBe(1);
    });

    it('reports verification as in force once the month reaches the cutoff', async () => {
      // February is month 11 of the financial year; a January cutoff is month 10.
      jest.useFakeTimers().setSystemTime(new Date('2027-02-10T12:00:00Z'));
      arrange({ config: { proofVerificationRequired: true, proofCutoffMonth: 1 } });

      const result = await service.summary(TENANT, EMPLOYEE, FY);

      expect(result.verificationInForce).toBe(true);
    });

    it('reports verification as not yet in force before the cutoff', async () => {
      // June is month 3 of the financial year, well short of a January cutoff.
      jest.useFakeTimers().setSystemTime(new Date('2026-06-10T12:00:00Z'));
      arrange({ config: { proofVerificationRequired: true, proofCutoffMonth: 1 } });

      const result = await service.summary(TENANT, EMPLOYEE, FY);

      expect(result.verificationInForce).toBe(false);
    });

    it('treats a tenant with no statutory configuration as not requiring proofs', async () => {
      arrange({ config: null });

      const result = await service.summary(TENANT, EMPLOYEE, FY);

      expect(result.verificationInForce).toBe(false);
    });

    it('scopes every query it runs by tenant', async () => {
      arrange({});

      await service.summary(TENANT, EMPLOYEE, FY);

      expect(prisma.employeeTaxDeclaration.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, employeeId: EMPLOYEE, financialYear: FY },
        }),
      );
      expect(prisma.statutoryConfig.findUnique).toHaveBeenCalledWith({
        where: { tenantId: TENANT },
      });
      expect(prisma.investmentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, employeeId: EMPLOYEE, financialYear: FY },
        }),
      );
    });

    it('refuses an account with no employee record before running any query', async () => {
      await expect(service.summary(TENANT, undefined, FY)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.investmentProof.findMany).not.toHaveBeenCalled();
      expect(prisma.employeeTaxDeclaration.findFirst).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Financial year defaulting
  // -------------------------------------------------------------------------

  describe('financial year', () => {
    it('defaults to the year in progress: March 2027 still belongs to FY 2026-27', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-03-31T12:00:00Z'));
      (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue([]);

      await service.listMine(TENANT, EMPLOYEE);

      expect(prisma.investmentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ financialYear: 2026 }),
        }),
      );
    });

    it('rolls over in April: April 2027 is FY 2027-28', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2027-04-01T12:00:00Z'));
      (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue([]);

      await service.listMine(TENANT, EMPLOYEE);

      expect(prisma.investmentProof.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ financialYear: 2027 }),
        }),
      );
    });
  });

  it('says whether the employer requires proofs at all, not only whether they bite yet', async () => {
    // An employee needs to tell three states apart: the employer does not
    // require proofs, it does but the cutoff has not arrived, and it does and
    // they are in force. `verificationInForce` alone collapses the first two
    // into false, and the page would otherwise have to read the tenant
    // configuration, which an ordinary employee is not allowed to do.
    (prisma.statutoryConfig.findUnique as jest.Mock).mockResolvedValue({
      proofVerificationRequired: true,
      proofCutoffMonth: 1,
    });
    (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.employeeTaxDeclaration.findUnique as jest.Mock).mockResolvedValue(null);

    const summary = await service.summary('tenant-1', 'emp-1', 2026);

    expect(summary.verificationRequired).toBe(true);
  });

  it('reports no requirement when the tenant has no configuration at all', async () => {
    (prisma.statutoryConfig.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.employeeTaxDeclaration.findUnique as jest.Mock).mockResolvedValue(null);

    const summary = await service.summary('tenant-1', 'emp-1', 2026);

    expect(summary.verificationRequired).toBe(false);
    expect(summary.verificationInForce).toBe(false);
  });

  it('never hands the storage key back to a client', async () => {
    // The key is the path the file sits at in storage. A client needs the id,
    // the name, the type and the size to render and download a proof; the key
    // only tells someone where the bytes live.
    (prisma.investmentProof.findMany as jest.Mock).mockResolvedValue([]);

    await service.listMine(TENANT, EMPLOYEE, 2026);

    const args = (prisma.investmentProof.findMany as jest.Mock).mock.calls[0][0];
    expect(args.include.upload.select).not.toHaveProperty('key');
  });

  it('refuses to file the same document twice under one head', async () => {
    // Two proofs pointing at one document, both approved, are summed twice.
    // That inflates a deduction and under-deducts tax on a real payslip.
    (prisma.upload.findFirst as jest.Mock).mockResolvedValue(makeUpload());
    (prisma.investmentProof.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.submit(TENANT, EMPLOYEE, USER, submitDto())).rejects.toThrow(
      /already been filed/i,
    );
  });
});
