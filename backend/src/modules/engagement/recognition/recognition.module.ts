import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EngagementSettingsModule } from '../settings/engagement-settings.module';
import { FeedModule } from '../feed/feed.module';
import { RecognitionController } from './recognition.controller';
import { RecognitionService } from './recognition.service';
import { BadgesService } from './badges.service';
import { RecognitionLeaderboardService } from './recognition-leaderboard.service';

/**
 * Recognition: badges, kudos, points, leaderboard (Wave E, WS3). Frozen after
 * the scaffold: WS3 fills the registered classes and may inject
 * PrismaService, NotificationsService, EngagementSettingsService and
 * FeedService.
 */
@Module({
  imports: [NotificationsModule, EngagementSettingsModule, FeedModule],
  controllers: [RecognitionController],
  providers: [RecognitionService, BadgesService, RecognitionLeaderboardService],
})
export class RecognitionModule {}
