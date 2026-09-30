import { currentEmployeeId } from './current-employee';

describe('currentEmployeeId', () => {
  it('reads the nested employee id, the shape the real login response stores', () => {
    const user = { role: 'EMPLOYEE', employee: { id: 'emp-1' } } as any;
    expect(currentEmployeeId(user)).toBe('emp-1');
  });

  it('falls back to a top-level employeeId when there is no nested employee', () => {
    expect(currentEmployeeId({ employeeId: 'emp-2' } as any)).toBe('emp-2');
  });

  it('prefers the top-level employeeId when both are present', () => {
    expect(currentEmployeeId({ employeeId: 'emp-2', employee: { id: 'emp-1' } } as any)).toBe(
      'emp-2',
    );
  });

  it('is undefined for a user with no employee record', () => {
    expect(currentEmployeeId({ role: 'SUPER_ADMIN' } as any)).toBeUndefined();
  });

  it('is undefined for a null or undefined user', () => {
    expect(currentEmployeeId(null)).toBeUndefined();
    expect(currentEmployeeId(undefined)).toBeUndefined();
  });
});
