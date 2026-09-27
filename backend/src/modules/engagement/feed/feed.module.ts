import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EngagementSettingsModule } from '../settings/engagement-settings.module';
import { FeedService } from './feed.service';
import { FeedQueryService } from './feed-query.service';
import { FeedCelebrationsService } from './feed-celebrations.service';
import { FeedCelebrationsCronService } from './feed-celebrations-cron.service';
import { FeedController } from './feed.controller';

/**
 * Social feed (Wave E). Frozen after the scaffold.
 *
 * FeedService (write side) is exported for producers: recognition,
 * announcements, later waves. The read side, reactions and the celebrations
 * cron are WS2's, pre-registered here as shells. ScheduleModule.forRoot() is
 * already registered by LeaveModule, so it is not registered again.
 * Importers (AnnouncementsModule, RecognitionModule) must not be imported
 * back from here, to keep the graph acyclic.
 */
@Module({
  imports: [NotificationsModule, EngagementSettingsModule],
  controllers: [FeedController],
  providers: [FeedService, FeedQueryService, FeedCelebrationsService, FeedCelebrationsCronService],
  exports: [FeedService],
})
export class FeedModule {}
