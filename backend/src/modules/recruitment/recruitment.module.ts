import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { UploadsModule } from '../uploads/uploads.module';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { LettersModule } from '../letters/letters.module';
// WS-D1: requisitions, openings, pipeline stages, candidates, applications
import { RequisitionsService } from './requisitions.service';
import { RequisitionsController } from './requisitions.controller';
import { RequisitionWorkflowHandler } from './requisition-workflow.handler';
import { JobOpeningsService } from './job-openings.service';
import { JobOpeningsController } from './job-openings.controller';
import { PipelineStagesService } from './pipeline-stages.service';
import { PipelineStagesController } from './pipeline-stages.controller';
import { CandidatesService } from './candidates.service';
import { CandidatesController } from './candidates.controller';
import { ApplicationsService } from './applications.service';
import { ApplicationsController } from './applications.controller';
// WS-D2: interviews, feedback, offers, conversion
import { InterviewsService } from './interviews.service';
import { InterviewsController } from './interviews.controller';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { OfferWorkflowHandler } from './offer-workflow.handler';
import { OfferConversionService } from './offer-conversion.service';
import { PublicOffersController } from './public-offers.controller';
// WS-D3: settings, careers page, pre-onboarding, funnel
import { RecruitmentSettingsService } from './recruitment-settings.service';
import { RecruitmentSettingsController } from './recruitment-settings.controller';
import { PublicCareersService } from './public-careers.service';
import { PublicCareersController } from './public-careers.controller';
import { PreOnboardingService } from './pre-onboarding.service';
import { PreOnboardingController } from './pre-onboarding.controller';
import { PublicPreOnboardingController } from './public-pre-onboarding.controller';
import { RecruitmentReportsService } from './recruitment-reports.service';
import { RecruitmentReportsController } from './recruitment-reports.controller';

/**
 * Keka wave D: hiring (applicant tracking).
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, Part D.
 *
 * Requisitions and offers are approved through the Wave B engine
 * (JOB_REQUISITION, OFFER handlers register with WorkflowRegistry). Public
 * controllers (careers, offer answer, pre-onboarding) apply no auth guard —
 * this codebase has no global guard — and throttle per route.
 * NotificationsModule, PrismaModule, AuditModule and EmailModule are global.
 */
@Module({
  imports: [WorkflowModule, UploadsModule, EmployeesModule, OnboardingModule, LettersModule],
  controllers: [
    RequisitionsController,
    JobOpeningsController,
    PipelineStagesController,
    CandidatesController,
    ApplicationsController,
    InterviewsController,
    OffersController,
    PublicOffersController,
    RecruitmentSettingsController,
    PublicCareersController,
    PreOnboardingController,
    PublicPreOnboardingController,
    RecruitmentReportsController,
  ],
  providers: [
    RequisitionsService,
    RequisitionWorkflowHandler,
    JobOpeningsService,
    PipelineStagesService,
    CandidatesService,
    ApplicationsService,
    InterviewsService,
    OffersService,
    OfferWorkflowHandler,
    OfferConversionService,
    RecruitmentSettingsService,
    PublicCareersService,
    PreOnboardingService,
    RecruitmentReportsService,
  ],
})
export class RecruitmentModule {}
