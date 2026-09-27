import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { EngagementModule } from './engagement.module';
import { FeedService } from './feed/feed.service';
import { EngagementSettingsService } from './settings/engagement-settings.service';
import { EngagementSettingsController } from './settings/engagement-settings.controller';
import { FeedController } from './feed/feed.controller';
import { SurveysController } from './surveys/surveys.controller';
import { PollsController } from './polls/polls.controller';
import { RecognitionController } from './recognition/recognition.controller';
import { OneOnOnesController } from './one-on-ones/one-on-ones.controller';

/** Stands in for the global PrismaModule (CI has no DATABASE_URL). */
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: createMockPrismaService() }],
  exports: [PrismaService],
})
class GlobalPrismaStubModule {}

/**
 * Scaffold guard (Keka wave E): the engagement module graph resolves, the
 * shared write-side services are available, and every area controller is
 * registered.
 */
describe('EngagementModule', () => {
  it('compiles and exposes FeedService and EngagementSettingsService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        ThrottlerModule.forRoot([]),
        GlobalPrismaStubModule,
        EngagementModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(createMockPrismaService())
      .compile();
    await moduleRef.init();

    expect(moduleRef.get(FeedService)).toBeInstanceOf(FeedService);
    expect(moduleRef.get(EngagementSettingsService)).toBeInstanceOf(EngagementSettingsService);
    for (const controller of [
      EngagementSettingsController,
      FeedController,
      SurveysController,
      PollsController,
      RecognitionController,
      OneOnOnesController,
    ]) {
      expect(moduleRef.get(controller, { strict: false })).toBeInstanceOf(controller);
    }

    await moduleRef.close();
  }, 30_000);
});
