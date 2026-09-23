import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AutoAbsentService } from './auto-absent.service';
import { zonedDateOnlyUtc, DEFAULT_ATTENDANCE_TIME_ZONE } from './late-mark';

/**
 * Closes the attendance day. 23:30 IST is late enough that day-shift punches
 * have landed and early enough that the day it is closing is still today in
 * India, so the sweep never has to reason about which day it means.
 *
 * Night-shift employees are not closed for today here — their shift may not
 * even have started. `runForAllTenants` closes yesterday for them instead,
 * once the shift that started yesterday evening has certainly ended.
 */
@Injectable()
export class AutoAbsentCronService {
  private readonly logger = new Logger(AutoAbsentCronService.name);

  constructor(private autoAbsent: AutoAbsentService) {}

  @Cron('30 23 * * *', {
    name: 'auto-mark-absent',
    timeZone: DEFAULT_ATTENDANCE_TIME_ZONE,
  })
  async handleNightlyAutoAbsent(): Promise<void> {
    const day = zonedDateOnlyUtc(new Date(), DEFAULT_ATTENDANCE_TIME_ZONE);
    this.logger.log(`Starting auto-absent sweep for ${day.toISOString().slice(0, 10)}`);

    try {
      const result = await this.autoAbsent.runForAllTenants(day);
      this.logger.log(
        `Auto-absent sweep done: ${result.tenants} tenants, ${result.marked} marked, ` +
          `${result.skipped} skipped, ${result.failed} failed`,
      );
    } catch (error) {
      this.logger.error(
        `Auto-absent sweep failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
