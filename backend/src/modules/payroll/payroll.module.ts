import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryService } from './salary.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { StatutoryService } from './statutory/statutory.service';
import { StatutoryController } from './statutory/statutory.controller';
import { PayrollPdfService } from './payroll-pdf.service';
import { ReturnsController } from './returns/returns.controller';
import { ReturnsService } from './returns/returns.service';
import { Form16Controller } from './form16/form16.controller';
import { Form16PdfService } from './form16/form16-pdf.service';
import { Form16Service } from './form16/form16.service';

@Module({
  controllers: [PayrollController, StatutoryController, ReturnsController, Form16Controller],
  providers: [PayrollService, SalaryService, PayrollCalculationService,
    StatutoryService, PayrollPdfService, ReturnsService, Form16Service, Form16PdfService],
  exports: [PayrollService, SalaryService],
})
export class PayrollModule {}
