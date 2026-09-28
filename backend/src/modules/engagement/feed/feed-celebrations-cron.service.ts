import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FeedCelebrationsService } from './feed-celebrations.service';
import { ENGAGEMENT_TIME_ZONE } from '../engagement-time';

/** Fires just after IST midnight so birthdays and anniversaries land on the feed for the day they belong to. */
@Injectable()
export class FeedCelebrationsCronService {
  private readonly logger = new Logger(FeedCelebrationsCronService.name);

  constructor(private readonly celebrations: FeedCelebrationsService) {}

  @Cron('10 0 * * *', {
    name: 'feed-celebrations',
    timeZone: ENGAGEMENT_TIME_ZONE,
  })
  async handleDailyCelebrations(): Promise<void> {
    try {
      const result = await this.celebrations.runForAllTenants(new Date());
      this.logger.log(
        `Feed celebrations sweep done: ${result.tenants} tenants, ${result.created} created, ${result.failed} failed`,
      );
    } catch (error) {
      this.logger.error(
        `Feed celebrations sweep failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
