import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LeaveCarryForwardService } from './leave-carry-forward.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccrualTriggerType } from '@prisma/client';
import { zonedDateOnlyUtc } from '../attendance/rules/late-mark';

/** The zone the cron fires in; the year it closes must be read in the same one. */
const CARRY_FORWARD_TZ = 'Asia/Kolkata';

@Injectable()
export class LeaveCarryForwardCronService {
  private readonly logger = new Logger(LeaveCarryForwardCronService.name);

  constructor(
    private carryForwardService: LeaveCarryForwardService,
    private prisma: PrismaService,
  ) {}

  /**
   * Run at 3 AM on 1 January. The year being closed is the one that just
   * ended, so `fromYear` is the cron's own calendar year minus one.
   *
   * That year has to be read in `CARRY_FORWARD_TZ`, not the server's zone:
   * 03:00 IST on 1 Jan 2027 is the instant 2026-12-31T21:30:00Z, so a
   * UTC-hosted box reading `new Date().getFullYear()` would say 2026 and
   * close 2025 a second time — which `runCarryForward` reports as
   * `alreadyRan`, so 2026 would silently never be carried forward at all.
   */
  @Cron('0 3 1 1 *', {
    name: 'year-end-leave-carry-forward',
    timeZone: CARRY_FORWARD_TZ,
  })
  async handleYearEndCarryForward() {
    this.logger.log('Starting year-end leave carry-forward cron job...');

    const fromYear =
      zonedDateOnlyUtc(new Date(), CARRY_FORWARD_TZ).getUTCFullYear() - 1;

    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });

      this.logger.log(
        `Processing carry-forward for ${tenants.length} tenants (fromYear ${fromYear})`,
      );

      for (const tenant of tenants) {
        try {
          const result = await this.carryForwardService.runCarryForward(
            tenant.id,
            fromYear,
            AccrualTriggerType.CRON_JOB,
          );

          if (result.alreadyRan) {
            this.logger.log(
              `Tenant ${tenant.name}: carry-forward for ${fromYear} already ran (run ${result.runId})`,
            );
          } else {
            this.logger.log(
              `Tenant ${tenant.name}: ${result.processedCount} processed, ${result.failedCount} failed`,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to carry forward for tenant ${tenant.name}: ${(error as Error).message}`,
          );
          // Continue with next tenant
        }
      }

      this.logger.log('Year-end leave carry-forward cron job completed');
    } catch (error) {
      this.logger.error(
        `Year-end leave carry-forward cron job failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
