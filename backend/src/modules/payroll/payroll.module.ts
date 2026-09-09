import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryService } from './salary.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { StatutoryService } from './statutory/statutory.service';
import { StatutoryController } from './statutory/statutory.controller';
import { PayrollPdfService } from './payroll-pdf.service';

@Module({
  controllers: [PayrollController, StatutoryController],
  providers: [PayrollService, SalaryService, PayrollCalculationService,
    StatutoryService, PayrollPdfService],
  exports: [PayrollService, SalaryService],
})
export class PayrollModule {}
