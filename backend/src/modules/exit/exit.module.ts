import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LoansModule } from '../loans/loans.module';
import { ExitController } from './exit.controller';
import { ExitService } from './exit.service';
import { SettlementController } from './settlement/settlement.controller';
import { SettlementService } from './settlement/settlement.service';

/**
 * Exit and full-and-final settlement.
 *
 * `LoansModule` is imported so a settlement can recover a leaver's
 * outstanding loans and advances through `LoansService` — reading balances on
 * compute and writing SETTLEMENT repayments on approval — rather than touching
 * loan rows from exit code. No cycle: LoansModule imports only notifications,
 * webhooks and workflow, and WorkflowModule imports no domain module.
 */
@Module({
  imports: [PrismaModule, LoansModule],
  controllers: [ExitController, SettlementController],
  providers: [ExitService, SettlementService],
  exports: [ExitService, SettlementService],
})
export class ExitModule {}
