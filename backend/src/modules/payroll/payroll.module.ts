import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryService } from './salary.service';
import { PayrollCalculationService } from './payroll-calculation.service';

@Module({
  controllers: [PayrollController],
  providers: [PayrollService, SalaryService, PayrollCalculationService],
  exports: [PayrollService, SalaryService],
})
export class PayrollModule {}
