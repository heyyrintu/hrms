import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LeaveController } from './leave.controller';
import { LeaveAccrualController } from './leave-accrual.controller';
import { CompOffController } from './comp-off.controller';
import { LeaveCarryForwardController } from './leave-carry-forward.controller';
import { LeaveService } from './leave.service';
import { LeaveAccrualService } from './leave-accrual.service';
import { LeaveAccrualCronService } from './leave-accrual-cron.service';
import { CompOffService } from './comp-off.service';
import { LeaveCarryForwardService } from './leave-carry-forward.service';
import { LeaveCarryForwardCronService } from './leave-carry-forward-cron.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule, AuditModule, HolidaysModule, WebhooksModule],
  controllers: [
    LeaveController,
    LeaveAccrualController,
    CompOffController,
    LeaveCarryForwardController,
  ],
  providers: [
    LeaveService,
    LeaveAccrualService,
    LeaveAccrualCronService,
    CompOffService,
    LeaveCarryForwardService,
    LeaveCarryForwardCronService,
  ],
  exports: [LeaveService, LeaveAccrualService, CompOffService, LeaveCarryForwardService],
})
export class LeaveModule {}
