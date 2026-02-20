import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LeaveController } from './leave.controller';
import { LeaveAccrualController } from './leave-accrual.controller';
import { CompOffController } from './comp-off.controller';
import { LeaveService } from './leave.service';
import { LeaveAccrualService } from './leave-accrual.service';
import { LeaveAccrualCronService } from './leave-accrual-cron.service';
import { CompOffService } from './comp-off.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [ScheduleModule.forRoot(), NotificationsModule, AuditModule],
  controllers: [LeaveController, LeaveAccrualController, CompOffController],
  providers: [LeaveService, LeaveAccrualService, LeaveAccrualCronService, CompOffService],
  exports: [LeaveService, LeaveAccrualService, CompOffService],
})
export class LeaveModule {}
