import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { OtCalculationService } from './ot-calculation.service';
import { RegularizationController } from './regularization.controller';
import { RegularizationService } from './regularization.service';
import { AttendancePolicyController } from './policy/attendance-policy.controller';
import { AttendancePolicyService } from './policy/attendance-policy.service';
import { AutoAbsentService } from './rules/auto-absent.service';
import { AutoAbsentCronService } from './rules/auto-absent-cron.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { RegularizationWorkflowHandler } from './regularization-workflow.handler';

@Module({
  imports: [NotificationsModule, WorkflowModule],
  controllers: [
    AttendanceController,
    RegularizationController,
    AttendancePolicyController,
  ],
  providers: [
    AttendanceService,
    OtCalculationService,
    RegularizationService,
    AttendancePolicyService,
    AutoAbsentService,
    AutoAbsentCronService,
    RegularizationWorkflowHandler,
  ],
  exports: [
    AttendanceService,
    OtCalculationService,
    RegularizationService,
    AttendancePolicyService,
    AutoAbsentService,
  ],
})
export class AttendanceModule {}
