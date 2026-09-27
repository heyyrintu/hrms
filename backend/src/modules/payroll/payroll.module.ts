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
import { WorkflowModule } from '../workflow/workflow.module';
import { PayrollWorkflowHandler } from './payroll-workflow.handler';
import { PayslipEmailService } from './payslip-email.service';
import { PayslipEmailProcessor } from './payslip-email.processor';
// Keka wave C, WS-C1: run mechanics (arrears, one-time payments, holds,
// reimbursements, settings)
import { PayrollAdjustmentsController } from './adjustments/payroll-adjustments.controller';
import { OneTimePaymentsService } from './adjustments/one-time-payments.service';
import { SalaryArrearsService } from './adjustments/salary-arrears.service';
import { SalaryHoldsService } from './adjustments/salary-holds.service';
import { PayrollReimbursementsService } from './adjustments/payroll-reimbursements.service';
import { PayrollSettingsService } from './adjustments/payroll-settings.service';
// Keka wave C, WS-C2: accounting export and variance report
import { PayrollAccountingController } from './accounting/payroll-accounting.controller';
import { PayrollReportsController } from './accounting/payroll-reports.controller';
import { GlMappingService } from './accounting/gl-mapping.service';
import { AccountingConfigService } from './accounting/accounting-config.service';
import { AccountingExportService } from './accounting/accounting-export.service';
import { VarianceReportService } from './accounting/variance-report.service';

@Module({
  // Payroll recovers loan and salary-advance instalments through LoansService;
  // run approval (maker-checker) goes through the workflow engine.
  imports: [LoansModule, WebhooksModule, WorkflowModule],
  controllers: [
    PayrollController,
    StatutoryController,
    ReturnsController,
    Form16Controller,
    ProofsController,
    SlabsController,
    PayrollAdjustmentsController,
    PayrollAccountingController,
    PayrollReportsController,
  ],
  providers: [PayrollService, SalaryService, PayrollCalculationService,
    StatutoryService, PayrollPdfService, ReturnsService, Form16Service, Form16PdfService, ProofsService, SlabsService,
    PayslipEmailService,
    PayrollWorkflowHandler,
    OneTimePaymentsService,
    SalaryArrearsService,
    SalaryHoldsService,
    PayrollReimbursementsService,
    PayrollSettingsService,
    GlMappingService,
    AccountingConfigService,
    AccountingExportService,
    VarianceReportService,
    // The `payroll` queue only exists when QueueModule registered it; without
    // Redis, PayslipEmailService sends directly and there is nothing to work.
    ...(process.env.REDIS_ENABLED === 'true' ? [PayslipEmailProcessor] : [])],
  exports: [PayrollService, SalaryService],
})
export class PayrollModule {}
