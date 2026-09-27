import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  // Keka wave D: an accepted offer starts onboarding through createProcess.
  exports: [OnboardingService],
})
export class OnboardingModule {}
