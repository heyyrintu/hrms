import { Module } from '@nestjs/common';
import { HelpdeskService } from './helpdesk.service';
import { HelpdeskController } from './helpdesk.controller';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * HR helpdesk: ticket categories, tickets with SLA, assignment, comments.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [HelpdeskController],
  providers: [HelpdeskService],
  exports: [HelpdeskService],
})
export class HelpdeskModule {}
