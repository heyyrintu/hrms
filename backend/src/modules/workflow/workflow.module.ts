import { Module } from '@nestjs/common';
import { ApprovalEngineService } from './approval-engine.service';
import { WorkflowRegistry } from './workflow-registry.service';
import { ApproverResolverService } from './approver-resolver.service';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { DelegationsService } from './delegations.service';
import { WorkflowsController } from './workflows.controller';
import { ApprovalsController } from './approvals.controller';

/**
 * Keka wave B: configurable multi-level approvals.
 *
 * Domain modules (leave, attendance, expenses, loans, payroll) import this
 * module, inject ApprovalEngineService, and register a WorkflowEntityHandler
 * with WorkflowRegistry. This module must never import a domain module.
 * NotificationsModule and PrismaModule are global.
 */
@Module({
  controllers: [WorkflowsController, ApprovalsController],
  providers: [
    ApprovalEngineService,
    WorkflowRegistry,
    ApproverResolverService,
    WorkflowDefinitionsService,
    DelegationsService,
  ],
  exports: [ApprovalEngineService, WorkflowRegistry],
})
export class WorkflowModule {}
