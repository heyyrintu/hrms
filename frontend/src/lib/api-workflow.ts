import { api } from '@/lib/api';

/**
 * Approval engine (Keka wave B): the cross-type inbox, approval trails,
 * delegations and the admin workflow builder.
 *
 * Types mirror `backend/src/modules/workflow/workflow.types.ts`. Every call goes
 * through the shared axios instance, so the auth interceptor applies; callers
 * unwrap `.data` themselves, as with the other `api-*.ts` clients.
 */

export type WorkflowEntityType =
  | 'LEAVE'
  | 'EXPENSE'
  | 'LOAN'
  | 'COMP_OFF'
  | 'REGULARIZATION'
  | 'PAYROLL_RUN';

export type WorkflowApproverType =
  | 'REPORTING_MANAGER'
  | 'MANAGERS_MANAGER'
  | 'HR_ADMIN'
  | 'SPECIFIC_USER'
  | 'ROLE';

export type WorkflowUserRole = 'SUPER_ADMIN' | 'HR_ADMIN' | 'MANAGER' | 'EMPLOYEE';

export const WORKFLOW_ENTITY_TYPES: WorkflowEntityType[] = [
  'LEAVE',
  'EXPENSE',
  'LOAN',
  'COMP_OFF',
  'REGULARIZATION',
  'PAYROLL_RUN',
];

export const WORKFLOW_ENTITY_LABELS: Record<WorkflowEntityType, string> = {
  LEAVE: 'Leave',
  EXPENSE: 'Expense',
  LOAN: 'Loan',
  COMP_OFF: 'Comp-Off',
  REGULARIZATION: 'Regularization',
  PAYROLL_RUN: 'Payroll Run',
};

export const APPROVER_TYPE_LABELS: Record<WorkflowApproverType, string> = {
  REPORTING_MANAGER: 'Reporting manager',
  MANAGERS_MANAGER: "Manager's manager",
  HR_ADMIN: 'HR admin',
  SPECIFIC_USER: 'Specific user',
  ROLE: 'Anyone with a role',
};

export const USER_ROLE_LABELS: Record<WorkflowUserRole, string> = {
  SUPER_ADMIN: 'Super admin',
  HR_ADMIN: 'HR admin',
  MANAGER: 'Manager',
  EMPLOYEE: 'Employee',
};

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

export interface InboxResponse {
  items: InboxItem[];
}

export type TrailStepState = 'APPROVED' | 'REJECTED' | 'PENDING' | 'WAITING' | 'CANCELLED';

export interface ApprovalTrailStep {
  order: number;
  name: string;
  approverType: WorkflowApproverType;
  state: TrailStepState;
  actedBy: UserRef | null;
  onBehalfOf: UserRef | null;
  isOverride: boolean;
  actedAt: string | null;
  note: string | null;
}

export interface ApprovalTrailView {
  instanceId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  round: number;
  currentStepOrder: number;
  canAct: boolean;
  steps: ApprovalTrailStep[];
}

export interface WorkflowDefinitionStepView {
  order: number;
  name: string;
  approverType: WorkflowApproverType;
  approverUserId: string | null;
  approverUserName: string | null;
  approverRole: WorkflowUserRole | null;
  minAmount: number | null;
  minDays: number | null;
}

export interface WorkflowDefinitionView {
  entityType: WorkflowEntityType;
  isCustom: boolean;
  name: string;
  adminOverride: boolean;
  allowSelfApproval: boolean;
  steps: WorkflowDefinitionStepView[];
}

export interface WorkflowStepInput {
  name: string;
  approverType: WorkflowApproverType;
  approverUserId?: string | null;
  approverRole?: WorkflowUserRole | null;
  minAmount?: number | null;
  minDays?: number | null;
}

export interface UpsertWorkflowPayload {
  name?: string;
  adminOverride?: boolean;
  allowSelfApproval?: boolean;
  steps: WorkflowStepInput[];
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

export interface DelegationsResponse {
  given: DelegationView[];
  received: DelegationView[];
}

export interface CreateDelegationPayload {
  delegateUserId: string;
  startDate: string;
  endDate: string;
  entityType?: WorkflowEntityType;
  reason?: string;
  /** HR/SUPER only: delegate on someone else's behalf. */
  delegatorUserId?: string;
}

export interface ApproverCandidate {
  id: string;
  name: string;
  email: string;
  role: WorkflowUserRole;
}

/** Only send a note when there is one, so an empty box is not a blank note. */
function noteBody(note?: string | null) {
  const trimmed = note?.trim();
  return trimmed ? { note: trimmed } : {};
}

export const workflowApi = {
  // Admin: workflow definitions

  /** All six entity types, built-in defaults included. */
  listDefinitions: () => api.get<WorkflowDefinitionView[]>('/workflows'),

  getDefinition: (entityType: WorkflowEntityType) =>
    api.get<WorkflowDefinitionView>(`/workflows/${entityType}`),

  /** Replaces the chain; affects new requests only. */
  saveDefinition: (entityType: WorkflowEntityType, data: UpsertWorkflowPayload) =>
    api.put<WorkflowDefinitionView>(`/workflows/${entityType}`, data),

  /** Drops the custom chain and returns the built-in default. */
  resetDefinition: (entityType: WorkflowEntityType) =>
    api.delete<WorkflowDefinitionView>(`/workflows/${entityType}`),

  // Everyone: inbox and actions

  getInbox: () => api.get<InboxResponse>('/approvals/inbox'),

  getTrail: (entityType: WorkflowEntityType, entityId: string) =>
    api.get<ApprovalTrailView>(`/approvals/${entityType}/${entityId}/trail`),

  approve: (entityType: WorkflowEntityType, entityId: string, note?: string | null) =>
    api.post(`/approvals/${entityType}/${entityId}/approve`, noteBody(note)),

  reject: (entityType: WorkflowEntityType, entityId: string, note?: string | null) =>
    api.post(`/approvals/${entityType}/${entityId}/reject`, noteBody(note)),

  // Delegations

  /** HR/SUPER may pass `all` to list every delegation in the tenant. */
  getDelegations: (params?: { all?: boolean }) =>
    api.get<DelegationsResponse>('/approvals/delegations', { params }),

  createDelegation: (data: CreateDelegationPayload) =>
    api.post<DelegationView>('/approvals/delegations', data),

  cancelDelegation: (id: string) => api.delete(`/approvals/delegations/${id}`),

  /** Active tenant users, max 20, for approver and delegate pickers. */
  searchUsers: (search: string) =>
    api.get<ApproverCandidate[]>('/approvals/users', { params: { search } }),
};
