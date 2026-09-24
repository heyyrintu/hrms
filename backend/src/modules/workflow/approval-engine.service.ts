import { Injectable, NotImplementedException } from '@nestjs/common';
import { ApprovalInstance, Prisma, WorkflowEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from './workflow-registry.service';
import {
  ActInput,
  ActResult,
  ApprovalTrailView,
  InboxItem,
  StartApprovalInput,
} from './workflow.types';

/**
 * The approval engine. SCAFFOLD: the signatures are the contract domain
 * modules code against; the bodies are implemented by the engine workstream.
 * See the spec section "Engine rules".
 */
@Injectable()
export class ApprovalEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly registry: WorkflowRegistry,
  ) {}

  /** Create (or restart, round + 1) the instance for an entity entering approval. */
  async start(input: StartApprovalInput): Promise<ApprovalInstance> {
    throw new NotImplementedException();
  }

  /** Notify the current step's approvers. Never throws (fire-and-forget safe). */
  async notifyPending(
    tenantId: string,
    entityType: WorkflowEntityType,
    entityId: string,
  ): Promise<void> {
    throw new NotImplementedException();
  }

  /** Authorize the actor for the current step, record the action, advance or finish. */
  async act(input: ActInput): Promise<ActResult> {
    throw new NotImplementedException();
  }

  /** Mark a PENDING instance CANCELLED. No-op when none or already terminal. */
  async cancel(
    tenantId: string,
    entityType: WorkflowEntityType,
    entityId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    throw new NotImplementedException();
  }

  /** Ids of PENDING entities of this type whose current step the actor may act on. */
  async listActionableEntityIds(
    actor: AuthenticatedUser,
    entityType: WorkflowEntityType,
  ): Promise<string[]> {
    throw new NotImplementedException();
  }

  /** Cross-type inbox for the actor, newest first. */
  async getInbox(actor: AuthenticatedUser): Promise<InboxItem[]> {
    throw new NotImplementedException();
  }

  /** Approval trail of one entity (current round). */
  async getTrail(
    actor: AuthenticatedUser,
    entityType: WorkflowEntityType,
    entityId: string,
  ): Promise<ApprovalTrailView> {
    throw new NotImplementedException();
  }
}
