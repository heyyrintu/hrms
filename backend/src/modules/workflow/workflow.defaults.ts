import { WorkflowEntityType } from '@prisma/client';
import { WorkflowDefaultDefinition } from './workflow.types';

/**
 * Built-in chains used when a tenant has no WorkflowDefinition row for a type.
 * They reproduce the pre-Wave-B single-level behaviour. The migration
 * 20260924100000_keka_wave_b backfills in-flight requests with these same
 * snapshots — keep the two in step.
 */
const REPORTING_MANAGER_ONLY = {
  adminOverride: true,
  allowSelfApproval: true,
  steps: [{ name: 'Reporting manager', approverType: 'REPORTING_MANAGER' as const }],
};

const HR_ONLY = {
  adminOverride: true,
  allowSelfApproval: true,
  steps: [{ name: 'HR approval', approverType: 'HR_ADMIN' as const }],
};

export const WORKFLOW_DEFAULTS: Record<WorkflowEntityType, WorkflowDefaultDefinition> = {
  LEAVE: { name: 'Leave approval', ...REPORTING_MANAGER_ONLY },
  EXPENSE: { name: 'Expense claim approval', ...REPORTING_MANAGER_ONLY },
  COMP_OFF: { name: 'Comp-off approval', ...REPORTING_MANAGER_ONLY },
  REGULARIZATION: { name: 'Attendance regularization approval', ...REPORTING_MANAGER_ONLY },
  LOAN: { name: 'Loan approval', ...HR_ONLY },
  // Maker-checker: whoever computed the run may not approve it.
  PAYROLL_RUN: { name: 'Payroll run approval', ...HR_ONLY, allowSelfApproval: false },
};

export const WORKFLOW_ENTITY_TYPES = Object.keys(WORKFLOW_DEFAULTS) as WorkflowEntityType[];
