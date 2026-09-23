import { Module } from '@nestjs/common';
import { LoansService } from './loans.service';
import { LoansController } from './loans.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebhooksModule } from '../webhooks/webhooks.module';

/**
 * Employee loans and salary advances.
 *
 * `LoansService` is exported because payroll deducts instalments through it:
 * `getPayrollDeductions` during the run and `recordPayrollRepayments` once the
 * payslip is final. PrismaModule is global, so only notifications are imported.
 */
@Module({
  imports: [NotificationsModule, WebhooksModule],
  controllers: [LoansController],
  providers: [LoansService],
  exports: [LoansService],
})
export class LoansModule {}
