import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseWorkflowHandler } from './expense-workflow.handler';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowModule } from '../workflow/workflow.module';

@Module({
  imports: [NotificationsModule, WorkflowModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseWorkflowHandler],
})
export class ExpensesModule {}
