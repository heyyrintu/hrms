import { PERMISSIONS, PERMISSION_KEYS, isPermission } from './permissions';

describe('permission catalogue', () => {
  it('has unique keys', () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(PERMISSION_KEYS.size).toBe(keys.length);
  });

  it('gives every entry a group, label and description', () => {
    for (const p of PERMISSIONS) {
      expect(p.group).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });

  it('does not make security administration grantable', () => {
    expect(isPermission('security.manage')).toBe(false);
  });

  it('recognises catalogue keys only', () => {
    expect(isPermission('org.manage')).toBe(true);
    expect(isPermission('payroll.reports.view')).toBe(true);
    expect(isPermission('org.manage ')).toBe(false);
    expect(isPermission('everything')).toBe(false);
  });
});
