import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { LoanWorkflowHandler } from './loan-workflow.handler';

/**
 * Employee loans and salary advances.
 *
 * `LoansService` is exported because payroll deducts instalments through it
 * (`getPayrollDeductions` during the run, `recordPayrollRepayments` inside the
 * run's write transaction) and the exit settlement recovers what a leaver
 * still owes (`getOutstandingForSettlement` on compute,
 * `recordSettlementRepayments` on approval). PrismaModule is global, so only
 * notifications, webhooks and the approval workflow are imported — which is
 * what lets ExitModule import this without a cycle (WorkflowModule imports
 * no domain module).
 */
@Module({
  imports: [NotificationsModule, WebhooksModule, WorkflowModule],
  controllers: [LoansController],
  providers: [LoansService, LoanWorkflowHandler],
  exports: [LoansService],
})
export class LoansModule {}
