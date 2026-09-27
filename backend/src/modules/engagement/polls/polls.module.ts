import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PollsController } from './polls.controller';
import { PollsService } from './polls.service';

/**
 * Dashboard polls (Wave E, WS2). Frozen after the scaffold: WS2 fills the
 * registered classes and may inject PrismaService and NotificationsService.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [PollsController],
  providers: [PollsService],
})
export class PollsModule {}
