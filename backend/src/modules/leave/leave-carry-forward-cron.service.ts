import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LeaveCarryForwardService } from './leave-carry-forward.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccrualTriggerType } from '@prisma/client';

@Injectable()
export class LeaveCarryForwardCronService {
  private readonly logger = new Logger(LeaveCarryForwardCronService.name);

  constructor(
    private carryForwardService: LeaveCarryForwardService,
    private prisma: PrismaService,
  ) {}

  /**
   * Run at 3 AM on 1 January. The year being closed is the one that just
   * ended, so `fromYear = now.getFullYear() - 1`.
   */
  @Cron('0 3 1 1 *', {
    name: 'year-end-leave-carry-forward',
    timeZone: 'Asia/Kolkata',
  })
  async handleYearEndCarryForward() {
    this.logger.log('Starting year-end leave carry-forward cron job...');

    const fromYear = new Date().getFullYear() - 1;

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
