import { Module } from '@nestjs/common';
import { IclockController } from './iclock.controller';
import { BiometricAdminController } from './biometric-admin.controller';
import { BiometricService } from './biometric.service';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AttendanceModule],
  controllers: [IclockController, BiometricAdminController],
  providers: [BiometricService],
})
export class BiometricModule {}
