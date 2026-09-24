import {
  Prisma,
  UserRole,
  WorkflowApproverType,
  WorkflowEntityType,
} from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

/**
 * Shared contract of the approval engine (Keka wave B).
 * Spec: docs/superpowers/specs/2026-09-24-keka-wave-b-workflow-engine-design.md
 */

/** One step of an instance's resolved chain, stored in ApprovalInstance.steps. */
export interface ApprovalStepSnapshot {
  /** 1-based, contiguous after condition filtering. */
  order: number;
  name: string;
  approverType: WorkflowApproverType;
  approverUserId: string | null;
  approverRole: UserRole | null;
}

/** A step as configured on a definition (or a built-in default). */
export interface WorkflowStepConfig {
  name: string;
  approverType: WorkflowApproverType;
  approverUserId?: string | null;
  approverRole?: UserRole | null;
  minAmount?: number | null;
  minDays?: number | null;
}

export interface WorkflowDefaultDefinition {
  name: string;
  adminOverride: boolean;
  allowSelfApproval: boolean;
  steps: WorkflowStepConfig[];
}

/** What the engine needs to know about a request to route it. */
export interface WorkflowEntityContext {
  /** Employee whose request it is. Null for payroll runs. */
  requesterEmployeeId: string | null;
  /** User who raised it (payroll: the run's processedById). Self-approval rule. */
  requesterUserId: string | null;
  /** Money value for minAmount conditions (expense amount, loan principal, run net). */
  amount?: number | null;
  /** Day count for minDays conditions (leave totalDays, comp-off earnedDays). */
  days?: number | null;
}

/** How a pending request is shown in the cross-type inbox. */
export interface WorkflowEntitySummary {
  entityId: string;
  /** e.g. "Casual Leave · 3 days" */
  title: string;
  /** e.g. "12 Oct – 14 Oct 2026" */
  subtitle: string | null;
  requesterName: string | null;
  /** Frontend route of the per-flow page, e.g. "/approvals/leave". */
  link: string;
  /** ISO timestamp the request was raised. */
  submittedAt: string;
}

/**
 * Implemented once per domain (leave, comp-off, regularization, expense, loan,
 * payroll) and registered with WorkflowRegistry in the handler's onModuleInit.
 * approve/reject MUST delegate to the domain service's own approve/reject so
 * each flow has a single approval code path.
 */
export interface WorkflowEntityHandler {
  readonly entityType: WorkflowEntityType;
  /** Null when the entity does not exist in the tenant or is not awaiting approval. */
  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null>;
  /** Summaries for the ids that still exist in the tenant; missing ids are skipped. */
  describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]>;
  approve(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown>;
  reject(actor: AuthenticatedUser, entityId: string, note?: string | null): Promise<unknown>;
}

export type ApprovalDecision = 'APPROVE' | 'REJECT';

export interface StartApprovalInput {
  tenantId: string;
  entityType: WorkflowEntityType;
  entityId: string;
  context: WorkflowEntityContext;
  /** Run inside the caller's transaction. Caller must then call notifyPending after commit. */
  tx?: Prisma.TransactionClient;
}

export interface ActInput {
  tenantId: string;
  entityType: WorkflowEntityType;
  entityId: string;
  actor: AuthenticatedUser;
  decision: ApprovalDecision;
  note?: string | null;
  /**
   * Runs inside the engine's transaction only when the request reaches a
   * terminal outcome (REJECT on any step, APPROVE on the last step). Put the
   * domain's final status transition / balance writes here. Throwing rolls
   * back the recorded action.
   */
  onFinal?: (tx: Prisma.TransactionClient) => Promise<void>;
}

export type ActOutcome = 'ADVANCED' | 'APPROVED' | 'REJECTED';

export interface ActResult {
  outcome: ActOutcome;
  instanceId: string;
  /** Step now awaiting action when outcome is ADVANCED, else null. */
  nextStepOrder: number | null;
}

export interface UserRef {
  userId: string;
  name: string;
}

export interface InboxItem {
  instanceId: string;
  entityType: WorkflowEntityType;
  entityId: string;
  title: string;
  subtitle: string | null;
  requesterName: string | null;
  link: string;
  submittedAt: string;
  currentStepOrder: number;
  totalSteps: number;
  currentStepName: string;
  /** Set when the viewer can act only as a delegate / leave cover. */
  onBehalfOf: UserRef | null;
}

export type TrailStepState = 'APPROVED' | 'REJECTED' | 'PENDING' | 'WAITING' | 'CANCELLED';

export interface ApprovalTrailView {
  instanceId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  round: number;
  currentStepOrder: number;
  canAct: boolean;
  steps: Array<{
    order: number;
    name: string;
    approverType: WorkflowApproverType;
    state: TrailStepState;
    actedBy: UserRef | null;
    onBehalfOf: UserRef | null;
    isOverride: boolean;
    actedAt: string | null;
    note: string | null;
  }>;
}

export interface WorkflowDefinitionView {
  entityType: WorkflowEntityType;
  isCustom: boolean;
  name: string;
  adminOverride: boolean;
  allowSelfApproval: boolean;
  steps: Array<{
    order: number;
    name: string;
    approverType: WorkflowApproverType;
    approverUserId: string | null;
    approverUserName: string | null;
    approverRole: UserRole | null;
    minAmount: number | null;
    minDays: number | null;
  }>;
}

export interface DelegationView {
  id: string;
  delegator: UserRef;
  delegate: UserRef;
  entityType: WorkflowEntityType | null;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, inclusive */
  endDate: string;
  reason: string | null;
  isActive: boolean;
  /** isActive and today within startDate..endDate */
  isCurrent: boolean;
}

export interface ApproverCandidate {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}
