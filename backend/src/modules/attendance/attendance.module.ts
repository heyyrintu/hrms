import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { OtCalculationService } from './ot-calculation.service';
import { RegularizationController } from './regularization.controller';
import { RegularizationService } from './regularization.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [AttendanceController, RegularizationController],
  providers: [AttendanceService, OtCalculationService, RegularizationService],
  exports: [AttendanceService, OtCalculationService, RegularizationService],
})
export class AttendanceModule {}
