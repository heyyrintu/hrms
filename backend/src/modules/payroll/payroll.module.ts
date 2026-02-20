import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryService } from './salary.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PayrollPdfService } from './payroll-pdf.service';

@Module({
  controllers: [PayrollController],
  providers: [PayrollService, SalaryService, PayrollCalculationService, PayrollPdfService],
  exports: [PayrollService, SalaryService],
})
export class PayrollModule {}
