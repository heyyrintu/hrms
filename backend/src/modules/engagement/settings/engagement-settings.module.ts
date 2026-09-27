import { Module } from '@nestjs/common';
import { EngagementSettingsController } from './engagement-settings.controller';
import { EngagementSettingsService } from './engagement-settings.service';

/** Per-tenant engagement settings. PrismaModule is global. */
@Module({
  controllers: [EngagementSettingsController],
  providers: [EngagementSettingsService],
  exports: [EngagementSettingsService],
})
export class EngagementSettingsModule {}
