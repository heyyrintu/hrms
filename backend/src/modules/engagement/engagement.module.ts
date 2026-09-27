import { Module } from '@nestjs/common';
import { EngagementSettingsModule } from './settings/engagement-settings.module';
import { FeedModule } from './feed/feed.module';
import { SurveysModule } from './surveys/surveys.module';
import { PollsModule } from './polls/polls.module';
import { RecognitionModule } from './recognition/recognition.module';
import { OneOnOnesModule } from './one-on-ones/one-on-ones.module';

/**
 * Keka wave E: engagement (pulse surveys, polls, recognition, social feed,
 * one-on-ones). Spec: docs/superpowers/specs/2026-09-28-keka-wave-e-design.md
 *
 * Re-exports FeedModule so producers elsewhere can inject FeedService.
 */
@Module({
  imports: [
    EngagementSettingsModule,
    FeedModule,
    SurveysModule,
    PollsModule,
    RecognitionModule,
    OneOnOnesModule,
  ],
  exports: [FeedModule],
})
export class EngagementModule {}
