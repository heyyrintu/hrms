import { PERMISSION_PATHS, permissionForPath } from './permission-paths';

describe('permissionForPath', () => {
  const original = { ...PERMISSION_PATHS };

  beforeEach(() => {
    for (const key of Object.keys(PERMISSION_PATHS)) delete PERMISSION_PATHS[key];
    Object.assign(PERMISSION_PATHS, {
      '/admin/departments': 'org.manage',
      '/payroll': 'payroll.reports.view',
      '/payroll/accounting': 'payroll.accounting.manage',
    });
  });

  afterAll(() => {
    for (const key of Object.keys(PERMISSION_PATHS)) delete PERMISSION_PATHS[key];
    Object.assign(PERMISSION_PATHS, original);
  });

  it('matches an exact path', () => {
    expect(permissionForPath('/admin/departments')).toBe('org.manage');
  });

  it('matches sub-pages on whole segments only', () => {
    expect(permissionForPath('/admin/departments/123')).toBe('org.manage');
    expect(permissionForPath('/admin/departments-archive')).toBeUndefined();
  });

  it('prefers the longest matching prefix', () => {
    expect(permissionForPath('/payroll/accounting/export')).toBe('payroll.accounting.manage');
    expect(permissionForPath('/payroll/variance')).toBe('payroll.reports.view');
  });

  it('returns undefined for unmapped or missing paths', () => {
    expect(permissionForPath('/admin/letters')).toBeUndefined();
    expect(permissionForPath(undefined)).toBeUndefined();
    expect(permissionForPath('')).toBeUndefined();
  });
});

describe('PERMISSION_PATHS entries (Keka wave H1, plan Task 1.5)', () => {
  it('lists only pages whose every API call is covered by one permission', () => {
    expect(PERMISSION_PATHS).toEqual({
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
    });
  });

  it('drops candidates whose page also calls a follow-up controller', () => {
    // employeesApi.getAll (GET /employees) is a follow-up.
    expect(PERMISSION_PATHS['/admin/shifts']).toBeUndefined();
    expect(PERMISSION_PATHS['/admin/biometric-devices']).toBeUndefined();
    expect(PERMISSION_PATHS['/exit-management']).toBeUndefined();
    // attendancePolicyApi.markAbsent (POST /attendance/mark-absent) is on the
    // main attendance controller, a follow-up.
    expect(PERMISSION_PATHS['/admin/attendance-policy']).toBeUndefined();
    // payrollApi.getRuns (GET /payroll/runs) is on the main payroll
    // controller, a follow-up.
    expect(PERMISSION_PATHS['/payroll/accounting']).toBeUndefined();
    expect(PERMISSION_PATHS['/payroll/variance']).toBeUndefined();
  });
});
