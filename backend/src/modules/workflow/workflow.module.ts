import { Module } from '@nestjs/common';
import { ApprovalEngineService } from './approval-engine.service';
import { WorkflowRegistry } from './workflow-registry.service';

/**
 * Keka wave B: configurable multi-level approvals.
 *
 * Domain modules (leave, attendance, expenses, loans, payroll) import this
 * module, inject ApprovalEngineService, and register a WorkflowEntityHandler
 * with WorkflowRegistry. This module must never import a domain module.
 * NotificationsModule and PrismaModule are global.
 */
@Module({
  controllers: [],
  providers: [ApprovalEngineService, WorkflowRegistry],
  exports: [ApprovalEngineService, WorkflowRegistry],
})
export class WorkflowModule {}
