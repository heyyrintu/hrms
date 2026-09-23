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
import { ProofsController } from './proofs/proofs.controller';
import { ProofsService } from './proofs/proofs.service';
import { SlabsController } from './slabs/slabs.controller';
import { SlabsService } from './slabs/slabs.service';
import { LoansModule } from '../loans/loans.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PayslipEmailService } from './payslip-email.service';
import { PayslipEmailProcessor } from './payslip-email.processor';

@Module({
  // Payroll recovers loan and salary-advance instalments through LoansService.
  imports: [LoansModule, WebhooksModule],
  controllers: [PayrollController, StatutoryController, ReturnsController, Form16Controller, ProofsController, SlabsController],
  providers: [PayrollService, SalaryService, PayrollCalculationService,
    StatutoryService, PayrollPdfService, ReturnsService, Form16Service, Form16PdfService, ProofsService, SlabsService,
    PayslipEmailService,
    // The `payroll` queue only exists when QueueModule registered it; without
    // Redis, PayslipEmailService sends directly and there is nothing to work.
    ...(process.env.REDIS_ENABLED === 'true' ? [PayslipEmailProcessor] : [])],
  exports: [PayrollService, SalaryService],
})
export class PayrollModule {}
