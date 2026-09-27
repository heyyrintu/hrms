import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { OneOnOnesController } from './one-on-ones.controller';
import { OneOnOnesService } from './one-on-ones.service';

/**
 * One-on-one meetings (Wave E, WS4). Frozen after the scaffold: WS4 fills the
 * registered classes and may inject PrismaService and NotificationsService.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [OneOnOnesController],
  providers: [OneOnOnesService],
})
export class OneOnOnesModule {}
