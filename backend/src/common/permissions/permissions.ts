/**
 * Permissions a tenant admin can put into a custom role (Keka wave H1).
 *
 * Custom roles are additive: they widen access on routes that opt in with
 * @RequirePermissions and never narrow what a fixed role already allows.
 * Security administration (SSO, 2FA policy, custom roles themselves) is
 * deliberately absent so a custom-role holder cannot grant themselves more.
 */
export const PERMISSIONS = [
  {
    key: 'org.manage',
    group: 'Organisation',
    label: 'Manage organisation setup',
    description: 'Departments, designations, branches, holidays, shifts, document expiry',
  },
  {
    key: 'attendance.config.manage',
    group: 'Attendance',
    label: 'Manage attendance setup',
    description: 'Attendance policy and biometric devices',
  },
  {
    key: 'leave.config.manage',
    group: 'Leave',
    label: 'Manage leave setup',
    description: 'Accrual rules and runs, carry-forward',
  },
  {
    key: 'payroll.statutory.manage',
    group: 'Payroll',
    label: 'Manage statutory setup',
    description: 'Statutory config, PT and income-tax slabs',
  },
  {
    key: 'payroll.proofs.review',
    group: 'Payroll',
    label: 'Review investment proofs',
    description: 'Approve or reject submitted proofs',
  },
  {
    key: 'payroll.reports.view',
    group: 'Payroll',
    label: 'View payroll reports',
    description: 'Statutory returns, bank transfer file, variance report',
  },
  {
    key: 'payroll.accounting.manage',
    group: 'Payroll',
    label: 'Manage payroll accounting',
    description: 'GL mapping, accounting config, journal export',
  },
  {
    key: 'payroll.adjustments.manage',
    group: 'Payroll',
    label: 'Manage payroll adjustments',
    description: 'Payroll settings, one-time payments, arrears, holds, settlements in a run',
  },
  {
    key: 'exit.manage',
    group: 'Exit',
    label: 'Manage exits',
    description: 'Separations and full and final settlement',
  },
  {
    key: 'recruitment.config.manage',
    group: 'Recruitment',
    label: 'Manage recruitment setup',
    description: 'Recruitment settings, pipeline stages, candidates',
  },
  {
    key: 'employees.import',
    group: 'Employees',
    label: 'Import employees',
    description: 'Bulk employee import',
  },
  {
    key: 'audit.view',
    group: 'Security',
    label: 'View audit log',
    description: 'Read the audit log',
  },
  {
    key: 'integrations.manage',
    group: 'Integrations',
    label: 'Manage integrations',
    description: 'Webhooks and approval workflow definitions',
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

export function isPermission(key: string): key is Permission {
  return PERMISSION_KEYS.has(key);
}
