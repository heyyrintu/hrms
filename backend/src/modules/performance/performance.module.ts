import { Module } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeedModule } from '../engagement/feed/feed.module';
import { GoalsController } from './goals/goals.controller';
import { GoalsService } from './goals/goals.service';
import { GoalProgressService } from './goals/goal-progress.service';
import { CalibrationController } from './calibration/calibration.controller';
import { CalibrationService } from './calibration/calibration.service';
import { CompetenciesController } from './competencies/competencies.controller';
import { CompetenciesService } from './competencies/competencies.service';
import { TemplatesController } from './templates/templates.controller';
import { TemplatesService } from './templates/templates.service';
import { PeerReviewsController } from './peer-reviews/peer-reviews.controller';
import { PeerReviewsService } from './peer-reviews/peer-reviews.service';

/**
 * Performance management. Wave F splits it into sub-folders (goals,
 * calibration, competencies, templates, peer-reviews), all registered here
 * under the one `/performance` prefix. Frozen after the Wave F scaffold.
 * AuditModule is global, so AuditService is injectable without an import.
 */
@Module({
  imports: [NotificationsModule, FeedModule],
  controllers: [
    PerformanceController, GoalsController, CalibrationController,
    CompetenciesController, TemplatesController, PeerReviewsController,
  ],
  providers: [
    PerformanceService, GoalsService, GoalProgressService, CalibrationService,
    CompetenciesService, TemplatesService, PeerReviewsService,
  ],
})
export class PerformanceModule {}
