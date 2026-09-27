import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { RequisitionsService } from './requisitions.service';

/**
 * JOB_REQUISITION approvals through the Wave B engine.
 * Scaffold (Keka wave D) — WS-D1 implements `describe` (title
 * `Requisition · <title> × <headcount>`, link `/recruitment/requisitions`) and
 * owns this file. approve / reject / getContext already delegate to the
 * service so there is one approval code path.
 */
@Injectable()
export class RequisitionWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = 'JOB_REQUISITION' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly requisitions: RequisitionsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    return this.requisitions.getWorkflowContext(tenantId, entityId);
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    void tenantId;
    void entityIds;
    // Scaffold: no JOB_REQUISITION instance can exist until WS-D1 ships submit.
    return [];
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.requisitions.approve(actor, entityId, note);
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.requisitions.reject(actor, entityId, note);
  }
}
