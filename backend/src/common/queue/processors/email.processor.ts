import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailService, EmailOptions } from '../../email/email.service';

@Processor('email')
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(private emailService: EmailService) {
    super();
  }

  async process(job: Job<EmailOptions>): Promise<void> {
    this.logger.debug(`Processing email job ${job.id}: ${job.data.subject}`);

    try {
      await this.emailService.sendEmail(job.data);
      this.logger.debug(`Email job ${job.id} completed`);
    } catch (error) {
      this.logger.error(
        `Email job ${job.id} failed: ${error instanceof Error ? error.message : error}`,
      );
      throw error;
    }
  }
}
