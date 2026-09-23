import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PayrollRunStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService, EmailOptions } from '../../common/email/email.service';
import { PayrollPdfService } from './payroll-pdf.service';

/** BullMQ queue the payslip jobs go on (registered by QueueModule when REDIS_ENABLED=true). */
export const PAYROLL_QUEUE = 'payroll';

/** Job name for "email this one payslip to its owner". */
export const PAYSLIP_EMAIL_JOB = 'payslip-email';

export interface PayslipEmailJobData {
  tenantId: string;
  payslipId: string;
}

const MONTH_NAMES = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTH_NAMES = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Deliberately loose: it only has to reject blanks and employee-code fallbacks. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Emails employees that their payslip is available once a payroll run is
 * approved, with the payslip PDF attached.
 *
 * Delivery strategy:
 * - With Redis (`REDIS_ENABLED=true`) one tiny job per payslip —
 *   `{ tenantId, payslipId }` — goes on the `payroll` queue, and
 *   {@link PayslipEmailProcessor} renders the PDF and sends it in the worker.
 *   The PDF is never put in Redis: job payloads stay a few bytes whatever the
 *   headcount, each job re-reads the payslip (so it can't mail a stale or
 *   since-discarded one), and a failure retries just that employee.
 * - Without Redis the same per-payslip send runs in-process, one employee at
 *   a time, each failure logged and skipped.
 *
 * Isolation: the recipient and the PDF both come from the same payslip row,
 * looked up by id AND tenantId, so an employee can only ever be sent their own
 * payslip.
 */
@Injectable()
export class PayslipEmailService {
  private readonly logger = new Logger(PayslipEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly pdfService: PayrollPdfService,
    private readonly configService: ConfigService,
    @Optional() @InjectQueue(PAYROLL_QUEUE) private readonly payrollQueue?: Queue,
  ) {}

  /**
   * Queue (or, without Redis, send) a payslip email for every payslip in the
   * run. Never throws and never rejects — callers need not await it.
   */
  async notifyRunApproved(tenantId: string, runId: string): Promise<void> {
    let payslipIds: string[];
    try {
      const payslips = await this.prisma.payslip.findMany({
        where: { tenantId, payrollRunId: runId },
        select: { id: true },
      });
      payslipIds = payslips.map((p) => p.id);
    } catch (error) {
      this.logger.error(
        `Could not list payslips for run ${runId}; no payslip emails sent: ${describe(error)}`,
      );
      return;
    }

    if (payslipIds.length === 0) return;

    if (this.payrollQueue) {
      try {
        await this.payrollQueue.addBulk(
          payslipIds.map((payslipId) => ({
            name: PAYSLIP_EMAIL_JOB,
            data: { tenantId, payslipId } satisfies PayslipEmailJobData,
            opts: {
              // Dedupes while a job for this payslip is still pending.
              jobId: `payslip-email-${payslipId}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 30_000 },
              removeOnComplete: true,
              removeOnFail: 1000,
            },
          })),
        );
        this.logger.log(`Queued ${payslipIds.length} payslip email(s) for run ${runId}`);
        return;
      } catch (error) {
        this.logger.error(
          `Could not queue payslip emails for run ${runId}, sending directly: ${describe(error)}`,
        );
      }
    }

    await this.sendDirect(tenantId, runId, payslipIds);
  }

  /**
   * Email one payslip to the employee it belongs to. Returns 'skipped' when
   * the payslip is not found in this tenant, its run is not published, or the
   * employee has no usable address. Throws on unexpected failures so the queue
   * can retry.
   */
  async sendPayslipEmail(tenantId: string, payslipId: string): Promise<'sent' | 'skipped'> {
    const payslip = await this.prisma.payslip.findFirst({
      where: {
        id: payslipId,
        tenantId,
        payrollRun: {
          status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
        },
      },
      include: {
        employee: {
          select: {
            firstName: true,
            lastName: true,
            employeeCode: true,
            email: true,
            designation: true,
            department: { select: { name: true } },
          },
        },
        payrollRun: { select: { month: true, year: true, status: true } },
        tenant: { select: { name: true } },
      },
    });

    if (!payslip) {
      this.logger.warn(`Payslip ${payslipId} not found or not published; email skipped`);
      return 'skipped';
    }

    const email = payslip.employee?.email?.trim();
    if (!email || !EMAIL_SHAPE.test(email)) {
      this.logger.warn(`Payslip ${payslipId}: employee has no usable email; skipped`);
      return 'skipped';
    }

    const month = payslip.payrollRun.month;
    const year = payslip.payrollRun.year;
    const periodLabel = `${MONTH_NAMES[month] ?? ''} ${year}`.trim();

    const attachments = await this.renderAttachment(payslip, month, year);

    const frontendUrl = (
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');

    const options: EmailOptions = {
      to: email,
      subject: `Your payslip for ${periodLabel} is available`,
      template: 'payslip-published',
      // No salary figures in the body: they are in the PDF and in the app.
      context: {
        employeeName: `${payslip.employee.firstName} ${payslip.employee.lastName}`.trim(),
        periodLabel,
        companyName: payslip.tenant?.name || 'HRMS',
        payslipUrl: `${frontendUrl}/my-payslips`,
        hasAttachment: !!attachments,
      },
    };
    if (attachments) options.attachments = attachments;

    await this.emailService.sendEmail(options);
    return 'sent';
  }

  private async sendDirect(tenantId: string, runId: string, payslipIds: string[]) {
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    // Sequential on purpose: a 500-person run must not open 500 SMTP
    // connections or render 500 PDFs at once in the API process.
    for (const payslipId of payslipIds) {
      try {
        const outcome = await this.sendPayslipEmail(tenantId, payslipId);
        if (outcome === 'sent') sent++;
        else skipped++;
      } catch (error) {
        failed++;
        this.logger.error(`Payslip email for ${payslipId} failed: ${describe(error)}`);
      }
    }
    this.logger.log(
      `Payslip emails for run ${runId}: ${sent} sent, ${skipped} skipped, ${failed} failed`,
    );
  }

  /** The PDF attachment, or undefined when disabled or rendering failed. */
  private async renderAttachment(
    payslip: { id: string; employee: { employeeCode: string } },
    month: number,
    year: number,
  ): Promise<EmailOptions['attachments']> {
    const attach =
      String(this.configService.get<string>('PAYSLIP_EMAIL_ATTACH_PDF') ?? 'true').toLowerCase() !==
      'false';
    if (!attach) return undefined;

    try {
      // Same row shape the download endpoint renders (JSON/Decimal columns).
      const pdf = await this.pdfService.generatePayslipPdf(payslip as any);
      return [
        {
          filename: `payslip-${payslip.employee.employeeCode}-${SHORT_MONTH_NAMES[month] ?? month}-${year}.pdf`,
          contentType: 'application/pdf',
          contentBase64: pdf.toString('base64'),
        },
      ];
    } catch (error) {
      // A link-only email is better than none.
      this.logger.error(
        `Could not render PDF for payslip ${payslip.id}, sending link only: ${describe(error)}`,
      );
      return undefined;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
