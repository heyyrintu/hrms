import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { OtCalculationService } from './ot-calculation.service';

@Module({
  controllers: [AttendanceController],
  providers: [AttendanceService, OtCalculationService],
  exports: [AttendanceService, OtCalculationService],
})
export class AttendanceModule {}
