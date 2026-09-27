import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { OffersService } from './offers.service';

/**
 * OFFER approvals through the Wave B engine.
 * Scaffold (Keka wave D) — WS-D2 implements `describe` (title
 * `Offer · <candidate> · <job title>`, subtitle the CTC, link
 * `/recruitment/offers`) and owns this file. approve / reject / getContext
 * already delegate to the service.
 */
@Injectable()
export class OfferWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = 'OFFER' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly offers: OffersService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    return this.offers.getWorkflowContext(tenantId, entityId);
  }

  async describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    void tenantId;
    void entityIds;
    // Scaffold: no OFFER instance can exist until WS-D2 ships submit.
    return [];
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.offers.approve(actor, entityId, note);
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown> {
    return this.offers.reject(actor, entityId, note);
  }
}
