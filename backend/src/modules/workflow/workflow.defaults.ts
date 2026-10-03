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
  // Keka wave D (hiring). Nothing was in flight when these were added, so no
  // migration backfill mirrors them. Self-approval stays allowed so a
  // one-person HR team is not deadlocked; tenants tighten it in the builder.
  JOB_REQUISITION: { name: 'Job requisition approval', ...HR_ONLY },
  OFFER: { name: 'Job offer approval', ...HR_ONLY },
  // Keka wave G (time and attendance)
  WFH_REQUEST: { name: 'Work from home approval', ...REPORTING_MANAGER_ONLY },
  ON_DUTY_REQUEST: { name: 'On-duty approval', ...REPORTING_MANAGER_ONLY },
  TIMESHEET: { name: 'Timesheet approval', ...REPORTING_MANAGER_ONLY },
};

export const WORKFLOW_ENTITY_TYPES = Object.keys(WORKFLOW_DEFAULTS) as WorkflowEntityType[];
