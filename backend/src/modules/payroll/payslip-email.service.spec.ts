import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { PayrollRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { createMockPrismaService, createMockEmailService } from '../../test/helpers';
import { PayrollPdfService } from './payroll-pdf.service';
import {
  PayslipEmailService,
  PAYROLL_QUEUE,
  PAYSLIP_EMAIL_JOB,
} from './payslip-email.service';

describe('PayslipEmailService', () => {
  const tenantId = 'tenant-1';
  const runId = 'run-1';

  let prisma: any;
  let emailService: jest.Mocked<EmailService>;
  let pdfService: { generatePayslipPdf: jest.Mock };
  let env: Record<string, string | undefined>;
  let queue: { addBulk: jest.Mock } | undefined;

  const pdfBytes = Buffer.from('%PDF-1.4 fake payslip');

  const payslipRow = (id: string, employee: Record<string, unknown>) => ({
    id,
    tenantId,
    payrollRunId: runId,
    employeeId: `emp-${id}`,
    netPay: 50000,
    employee: {
      firstName: 'Asha',
      lastName: 'Rao',
      employeeCode: 'EMP001',
      email: 'asha@acme.test',
      designation: 'Engineer',
      department: { name: 'Engineering' },
      ...employee,
    },
    payrollRun: { month: 9, year: 2026, status: PayrollRunStatus.APPROVED },
    tenant: { name: 'Acme Corp' },
  });

  async function build(withQueue: boolean): Promise<PayslipEmailService> {
    prisma = createMockPrismaService();
    emailService = createMockEmailService();
    pdfService = { generatePayslipPdf: jest.fn().mockResolvedValue(pdfBytes) };
    queue = withQueue ? { addBulk: jest.fn().mockResolvedValue([]) } : undefined;

    const providers: any[] = [
      PayslipEmailService,
      { provide: PrismaService, useValue: prisma },
      { provide: EmailService, useValue: emailService },
      { provide: PayrollPdfService, useValue: pdfService },
      {
        provide: ConfigService,
        useValue: {
          get: jest.fn((key: string, def?: unknown) => env[key] ?? def),
        },
      },
    ];
    if (withQueue) {
      providers.push({ provide: getQueueToken(PAYROLL_QUEUE), useValue: queue });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers,
    }).compile();
    return module.get(PayslipEmailService);
  }

  beforeEach(() => {
    env = { FRONTEND_URL: 'https://hr.acme.test/' };
  });

  // ============================================
  // notifyRunApproved — queue path
  // ============================================

  describe('notifyRunApproved with Redis queue', () => {
    it('enqueues one small job per payslip in the run, scoped to the tenant', async () => {
      const service = await build(true);
      prisma.payslip.findMany.mockResolvedValue([{ id: 'ps-1' }, { id: 'ps-2' }]);

      await service.notifyRunApproved(tenantId, runId);

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, payrollRunId: runId },
          select: { id: true },
        }),
      );
      expect(queue!.addBulk).toHaveBeenCalledTimes(1);
      const jobs = queue!.addBulk.mock.calls[0][0];
      expect(jobs).toHaveLength(2);
      expect(jobs[0]).toEqual(
        expect.objectContaining({
          name: PAYSLIP_EMAIL_JOB,
          data: { tenantId, payslipId: 'ps-1' },
          opts: expect.objectContaining({ jobId: 'payslip-email-ps-1' }),
        }),
      );
      // The PDF is rendered by the worker, never carried in the job payload.
      expect(JSON.stringify(jobs)).not.toContain('base64');
      expect(pdfService.generatePayslipPdf).not.toHaveBeenCalled();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('does nothing when the run has no payslips', async () => {
      const service = await build(true);
      prisma.payslip.findMany.mockResolvedValue([]);

      await service.notifyRunApproved(tenantId, runId);

      expect(queue!.addBulk).not.toHaveBeenCalled();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it('falls back to sending directly when enqueueing fails', async () => {
      const service = await build(true);
      prisma.payslip.findMany.mockResolvedValue([{ id: 'ps-1' }]);
      queue!.addBulk.mockRejectedValue(new Error('redis down'));
      prisma.payslip.findFirst.mockResolvedValue(payslipRow('ps-1', {}));

      await expect(service.notifyRunApproved(tenantId, runId)).resolves.toBeUndefined();

      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // notifyRunApproved — direct fallback
  // ============================================

  describe('notifyRunApproved without Redis', () => {
    it('sends to each employee their own payslip, sequentially', async () => {
      const service = await build(false);
      prisma.payslip.findMany.mockResolvedValue([{ id: 'ps-1' }, { id: 'ps-2' }]);
      prisma.payslip.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.id === 'ps-1'
            ? payslipRow('ps-1', { email: 'one@acme.test', employeeCode: 'E1' })
            : payslipRow('ps-2', { email: 'two@acme.test', employeeCode: 'E2' }),
        ),
      );

      await service.notifyRunApproved(tenantId, runId);

      expect(emailService.sendEmail).toHaveBeenCalledTimes(2);
      const [first, second] = emailService.sendEmail.mock.calls.map((c) => c[0]);
      expect(first.to).toBe('one@acme.test');
      expect(first.attachments?.[0].filename).toContain('E1');
      expect(second.to).toBe('two@acme.test');
      expect(second.attachments?.[0].filename).toContain('E2');
    });

    it('keeps going when one employee fails, and never rejects', async () => {
      const service = await build(false);
      prisma.payslip.findMany.mockResolvedValue([{ id: 'ps-1' }, { id: 'ps-2' }]);
      prisma.payslip.findFirst
        .mockRejectedValueOnce(new Error('db blip'))
        .mockResolvedValueOnce(payslipRow('ps-2', {}));

      await expect(service.notifyRunApproved(tenantId, runId)).resolves.toBeUndefined();

      expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('never rejects when the payslip lookup itself fails', async () => {
      const service = await build(false);
      prisma.payslip.findMany.mockRejectedValue(new Error('db down'));

      await expect(service.notifyRunApproved(tenantId, runId)).resolves.toBeUndefined();
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // sendPayslipEmail
  // ============================================

  describe('sendPayslipEmail', () => {
    it('loads the payslip scoped to tenant and to a published run', async () => {
      const service = await build(false);
      prisma.payslip.findFirst.mockResolvedValue(payslipRow('ps-1', {}));

      await service.sendPayslipEmail(tenantId, 'ps-1');

      const query = prisma.payslip.findFirst.mock.calls[0][0];
      expect(query.where).toEqual({
        id: 'ps-1',
        tenantId,
        payrollRun: {
          status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
        },
      });
    });

    it('emails the payslip owner with the rendered PDF attached', async () => {
      const service = await build(false);
      const row = payslipRow('ps-1', {});
      prisma.payslip.findFirst.mockResolvedValue(row);

      const result = await service.sendPayslipEmail(tenantId, 'ps-1');

      expect(result).toBe('sent');
      expect(pdfService.generatePayslipPdf).toHaveBeenCalledWith(row);
      expect(emailService.sendEmail).toHaveBeenCalledWith({
        to: 'asha@acme.test',
        subject: 'Your payslip for September 2026 is available',
        template: 'payslip-published',
        context: {
          employeeName: 'Asha Rao',
          periodLabel: 'September 2026',
          companyName: 'Acme Corp',
          payslipUrl: 'https://hr.acme.test/my-payslips',
          hasAttachment: true,
        },
        attachments: [
          {
            filename: 'payslip-EMP001-Sep-2026.pdf',
            contentType: 'application/pdf',
            contentBase64: pdfBytes.toString('base64'),
          },
        ],
      });
    });

    it('does not put salary figures in the email body context', async () => {
      const service = await build(false);
      prisma.payslip.findFirst.mockResolvedValue(payslipRow('ps-1', {}));

      await service.sendPayslipEmail(tenantId, 'ps-1');

      const ctx = emailService.sendEmail.mock.calls[0][0].context!;
      expect(JSON.stringify(ctx)).not.toContain('50000');
    });

    it('skips a payslip that is missing, from another tenant, or unpublished', async () => {
      const service = await build(false);
      prisma.payslip.findFirst.mockResolvedValue(null);

      await expect(service.sendPayslipEmail(tenantId, 'ps-x')).resolves.toBe('skipped');
      expect(emailService.sendEmail).not.toHaveBeenCalled();
    });

    it.each([[''], [null], ['EMP001'], ['not an email']])(
      'skips an employee whose email is %p',
      async (email) => {
        const service = await build(false);
        prisma.payslip.findFirst.mockResolvedValue(payslipRow('ps-1', { email }));

        await expect(service.sendPayslipEmail(tenantId, 'ps-1')).resolves.toBe('skipped');
        expect(pdfService.generatePayslipPdf).not.toHaveBeenCalled();
        expect(emailService.sendEmail).not.toHaveBeenCalled();
      },
    );

    it('sends a link-only email when PAYSLIP_EMAIL_ATTACH_PDF=false', async () => {
      env.PAYSLIP_EMAIL_ATTACH_PDF = 'false';
      const service = await build(false);
      prisma.payslip.findFirst.mockResolvedValue(payslipRow('ps-1', {}));

      await service.sendPayslipEmail(tenantId, 'ps-1');

      expect(pdfService.generatePayslipPdf).not.toHaveBeenCalled();
      const opts = emailService.sendEmail.mock.calls[0][0];
      expect(opts.attachments).toBeUndefined();
      expect(opts.context!.hasAttachment).toBe(false);
    });

    it('falls back to a link-only email when the PDF cannot be rendered', async () => {
      const service = await build(false);
      prisma.payslip.findFirst.mockResolvedValue(payslipRow('ps-1', {}));
      pdfService.generatePayslipPdf.mockRejectedValue(new Error('pdfkit exploded'));

      await expect(service.sendPayslipEmail(tenantId, 'ps-1')).resolves.toBe('sent');

      const opts = emailService.sendEmail.mock.calls[0][0];
      expect(opts.attachments).toBeUndefined();
      expect(opts.context!.hasAttachment).toBe(false);
    });

    it('uses the default frontend URL and company name when unset', async () => {
      env = {};
      const service = await build(false);
      const row = payslipRow('ps-1', {});
      (row as any).tenant = null;
      prisma.payslip.findFirst.mockResolvedValue(row);

      await service.sendPayslipEmail(tenantId, 'ps-1');

      const ctx = emailService.sendEmail.mock.calls[0][0].context!;
      expect(ctx.payslipUrl).toBe('http://localhost:3000/my-payslips');
      expect(ctx.companyName).toBe('HRMS');
    });
  });
});
