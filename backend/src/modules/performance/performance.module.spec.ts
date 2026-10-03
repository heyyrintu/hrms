import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { AuditModule } from '../audit/audit.module';
import { PerformanceModule } from './performance.module';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
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

/** Stands in for the global PrismaModule (CI has no DATABASE_URL). */
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: createMockPrismaService() }],
  exports: [PrismaService],
})
class GlobalPrismaStubModule {}

/**
 * Scaffold guard (Keka wave F): the performance module graph resolves and
 * every sub-folder controller and provider is registered. AuditModule is
 * global in AppModule and is imported here so services may inject
 * AuditService.
 */
describe('PerformanceModule', () => {
  it('compiles and registers every controller and provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ThrottlerModule.forRoot([]),
        GlobalPrismaStubModule,
        AuditModule,
        PerformanceModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(createMockPrismaService())
      .compile();
    await moduleRef.init();

    for (const provider of [
      PerformanceService,
      GoalsService,
      GoalProgressService,
      CalibrationService,
      CompetenciesService,
      TemplatesService,
      PeerReviewsService,
    ]) {
      expect(moduleRef.get(provider, { strict: false })).toBeInstanceOf(provider);
    }
    for (const controller of [
      PerformanceController,
      GoalsController,
      CalibrationController,
      CompetenciesController,
      TemplatesController,
      PeerReviewsController,
    ]) {
      expect(moduleRef.get(controller, { strict: false })).toBeInstanceOf(controller);
    }

    await moduleRef.close();
  }, 30_000);
});
