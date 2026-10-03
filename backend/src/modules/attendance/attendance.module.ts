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
// Keka wave G (time and attendance)
import { RosterModule } from '../roster/roster.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AttendanceRequestsService } from './requests/attendance-requests.service';
import { AttendanceRequestsController } from './requests/attendance-requests.controller';
import { WfhRequestWorkflowHandler } from './requests/wfh-request-workflow.handler';
import { OnDutyRequestWorkflowHandler } from './requests/on-duty-request-workflow.handler';
import { AttendanceCaptureService } from './capture/attendance-capture.service';
import { AttendanceCaptureController } from './capture/attendance-capture.controller';

@Module({
  imports: [
    NotificationsModule,
    WorkflowModule,
    // Keka wave G (time and attendance)
    RosterModule,
    UploadsModule,
  ],
  controllers: [
    AttendanceController,
    RegularizationController,
    AttendancePolicyController,
    // Keka wave G (time and attendance)
    AttendanceRequestsController,
    AttendanceCaptureController,
  ],
  providers: [
    AttendanceService,
    OtCalculationService,
    RegularizationService,
    AttendancePolicyService,
    AutoAbsentService,
    AutoAbsentCronService,
    RegularizationWorkflowHandler,
    // Keka wave G (time and attendance)
    AttendanceRequestsService,
    WfhRequestWorkflowHandler,
    OnDutyRequestWorkflowHandler,
    AttendanceCaptureService,
  ],
  exports: [
    AttendanceService,
    OtCalculationService,
    RegularizationService,
    AttendancePolicyService,
    AutoAbsentService,
    // Keka wave G (time and attendance)
    AttendanceRequestsService,
  ],
})
export class AttendanceModule {}
