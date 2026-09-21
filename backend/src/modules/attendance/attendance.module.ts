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

@Module({
  imports: [NotificationsModule],
  // AttendancePolicyController is registered first on purpose: Nest matches
  // routes in registration order and AttendanceController owns
  // `GET /attendance/:employeeId`, which would otherwise swallow
  // `GET /attendance/policy`.
  controllers: [
    AttendancePolicyController,
    AttendanceController,
    RegularizationController,
  ],
  providers: [
    AttendanceService,
    OtCalculationService,
    RegularizationService,
    AttendancePolicyService,
    AutoAbsentService,
    AutoAbsentCronService,
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
