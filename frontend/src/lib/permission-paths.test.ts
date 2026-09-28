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
