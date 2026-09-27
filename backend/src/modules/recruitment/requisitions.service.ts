import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowEntityContext } from '../workflow/workflow.types';
import { RequisitionView } from './recruitment.types';

/**
 * Job requisitions, approved through the workflow engine (JOB_REQUISITION).
 * Scaffold stub (Keka wave D) — implemented by WS-D1.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md
 */
@Injectable()
export class RequisitionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(actor: AuthenticatedUser, query: { status?: string }): Promise<RequisitionView[]> {
    void actor;
    void query;
    throw new NotImplementedException();
  }

  get(actor: AuthenticatedUser, id: string): Promise<RequisitionView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  create(actor: AuthenticatedUser, input: Record<string, unknown>): Promise<RequisitionView> {
    void actor;
    void input;
    throw new NotImplementedException();
  }

  update(actor: AuthenticatedUser, id: string, input: Record<string, unknown>): Promise<RequisitionView> {
    void actor;
    void id;
    void input;
    throw new NotImplementedException();
  }

  submit(actor: AuthenticatedUser, id: string): Promise<RequisitionView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  cancel(actor: AuthenticatedUser, id: string): Promise<RequisitionView> {
    void actor;
    void id;
    throw new NotImplementedException();
  }

  approve(actor: AuthenticatedUser, id: string, note?: string | null): Promise<RequisitionView> {
    void actor;
    void id;
    void note;
    throw new NotImplementedException();
  }

  reject(actor: AuthenticatedUser, id: string, note?: string | null): Promise<RequisitionView> {
    void actor;
    void id;
    void note;
    throw new NotImplementedException();
  }

  /** Null unless PENDING_APPROVAL. */
  getWorkflowContext(tenantId: string, id: string): Promise<WorkflowEntityContext | null> {
    void tenantId;
    void id;
    throw new NotImplementedException();
  }

  /**
   * Consumed by WS-D2 on offer conversion: filledCount + 1, FILLED at headcount.
   */
  recordHire(tenantId: string, requisitionId: string, tx?: Prisma.TransactionClient): Promise<void> {
    void tenantId;
    void requisitionId;
    void tx;
    throw new NotImplementedException();
  }
}
