import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';
import { SurveySubmissionService } from './survey-submission.service';
import { SurveyResultsService } from './survey-results.service';
import { SurveyReleaseService } from './survey-release.service';
import { SurveyReleaseCronService } from './survey-release-cron.service';

/**
 * Pulse surveys (Wave E, WS1). Frozen after the scaffold: WS1 fills the
 * registered classes and may inject PrismaService and NotificationsService.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [SurveysController],
  providers: [
    SurveysService,
    SurveySubmissionService,
    SurveyResultsService,
    SurveyReleaseService,
    SurveyReleaseCronService,
  ],
})
export class SurveysModule {}
