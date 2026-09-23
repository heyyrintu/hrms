import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  PayslipEmailService,
  PayslipEmailJobData,
  PAYROLL_QUEUE,
  PAYSLIP_EMAIL_JOB,
} from './payslip-email.service';

/**
 * Worker for the `payroll` queue. Only registered when REDIS_ENABLED=true
 * (see PayrollModule).
 *
 * BullMQ gives each queue one worker, so this is THE `payroll` queue worker:
 * any future payroll job must be routed here by name rather than given a
 * second @Processor('payroll'), which would steal and silently drop jobs.
 */
@Processor(PAYROLL_QUEUE)
export class PayslipEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(PayslipEmailProcessor.name);

  constructor(private readonly payslipEmailService: PayslipEmailService) {
    super();
  }

  async process(job: Job<PayslipEmailJobData>): Promise<void> {
    if (job.name !== PAYSLIP_EMAIL_JOB) {
      throw new Error(`Unhandled payroll job "${job.name}" (${job.id})`);
    }

    const { tenantId, payslipId } = job.data;
    try {
      const outcome = await this.payslipEmailService.sendPayslipEmail(tenantId, payslipId);
      this.logger.debug(`Payslip email job ${job.id}: ${outcome}`);
    } catch (error) {
      this.logger.error(
        `Payslip email job ${job.id} failed: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }
}
