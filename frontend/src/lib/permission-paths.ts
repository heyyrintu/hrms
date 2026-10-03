/**
 * Pages a custom-role holder may open because a permission covers every API
 * call the page makes (Keka wave H1). Fixed admin roles never need this map;
 * it only widens access, mirroring @RequirePermissions on the API.
 *
 * Paths are matched by longest prefix on whole segments.
 *
 * A candidate is listed here only when EVERY API call its page makes is
 * covered by the same permission (spec §4.3, plan Task 1.5). Several of the
 * spec's candidate paths call into a controller left as a follow-up
 * (spec §1.5, not decorated with @RequirePermissions in H1) and are
 * deliberately left out:
 * - `/admin/shifts` and `/admin/biometric-devices` call `employeesApi.getAll`
 *   (`GET /employees`, the employees module, a follow-up).
 * - `/admin/attendance-policy` calls `attendancePolicyApi.markAbsent`
 *   (`POST /attendance/mark-absent`, the main attendance controller, a
 *   follow-up — `attendance-policy.controller.ts` only owns GET/PUT of the
 *   policy itself).
 * - `/payroll/accounting` and `/payroll/variance` both call
 *   `payrollApi.getRuns` (`GET /payroll/runs`, the main payroll controller,
 *   a follow-up).
 * - `/exit-management` calls `employeesApi.getAll` too.
 */
export const PERMISSION_PATHS: Record<string, string> = {
  '/admin/departments': 'org.manage',
  '/admin/designations': 'org.manage',
  '/admin/branches': 'org.manage',
  '/admin/holidays': 'org.manage',
  '/admin/document-expiry': 'org.manage',
  '/admin/accrual-rules': 'leave.config.manage',
  '/admin/accrual-history': 'leave.config.manage',
  '/admin/statutory': 'payroll.statutory.manage',
  '/admin/slabs': 'payroll.statutory.manage',
  '/settlements': 'exit.manage',
  '/admin/recruitment-settings': 'recruitment.config.manage',
  '/admin/pipeline-stages': 'recruitment.config.manage',
  '/recruitment/candidates': 'recruitment.config.manage',
  '/employees/import': 'employees.import',
  '/admin/audit': 'audit.view',
  '/admin/webhooks': 'integrations.manage',
  '/admin/workflows': 'integrations.manage',
  // Keka wave G (time and attendance)
  '/admin/roster': 'attendance.roster.manage',
  '/reports/utilisation': 'projects.reports.view',
};

export function permissionForPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  let best: string | undefined;
  for (const prefix of Object.keys(PERMISSION_PATHS)) {
    const matches = path === prefix || path.startsWith(prefix + '/');
    if (matches && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? PERMISSION_PATHS[best] : undefined;
}
