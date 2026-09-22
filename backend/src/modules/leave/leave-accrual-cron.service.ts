import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LeaveAccrualService } from './leave-accrual.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccrualTriggerType } from '@prisma/client';
import { zonedDateOnlyUtc } from '../attendance/rules/late-mark';

/** The zone the cron fires in; the month it accrues must be read in the same one. */
const ACCRUAL_TZ = 'Asia/Kolkata';

@Injectable()
export class LeaveAccrualCronService {
  private readonly logger = new Logger(LeaveAccrualCronService.name);

  constructor(
    private accrualService: LeaveAccrualService,
    private prisma: PrismaService,
  ) {}

  /**
   * Run at 2 AM on the 1st day of every month.
   *
   * The month has to be read in `ACCRUAL_TZ`, not the server's zone: 02:00 IST
   * on 1 March is the instant 2026-02-28T20:30:00Z, so a UTC-hosted box
   * reading `now.getMonth()` would accrue February a second time rather than
   * March.
   */
  @Cron('0 2 1 * *', {
    name: 'monthly-leave-accrual',
    timeZone: ACCRUAL_TZ,
  })
  async handleMonthlyAccrual() {
    this.logger.log('Starting monthly leave accrual cron job...');

    const today = zonedDateOnlyUtc(new Date(), ACCRUAL_TZ);
    const month = today.getUTCMonth() + 1; // JavaScript months are 0-indexed
    const year = today.getUTCFullYear();

    try {
      // Get all active tenants
      const tenants = await this.prisma.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });

      this.logger.log(`Processing accrual for ${tenants.length} tenants`);

      for (const tenant of tenants) {
        try {
          this.logger.log(`Processing tenant: ${tenant.name} (${tenant.id})`);

          const result = await this.accrualService.triggerAccrual(
            tenant.id,
            { month, year },
            AccrualTriggerType.CRON_JOB,
          );

          this.logger.log(
            `Tenant ${tenant.name}: ${result.processedCount} processed, ${result.failedCount} failed`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to process tenant ${tenant.name}: ${(error as Error).message}`,
          );
          // Continue with next tenant
        }
      }

      this.logger.log('Monthly leave accrual cron job completed');
    } catch (error) {
      this.logger.error(
        `Monthly leave accrual cron job failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
