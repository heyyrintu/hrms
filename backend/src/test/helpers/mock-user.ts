import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

export const mockSuperAdmin: AuthenticatedUser = {
  userId: 'super-admin-id',
  email: 'superadmin@test.com',
  tenantId: 'test-tenant',
  role: 'SUPER_ADMIN' as any,
  employeeId: 'emp-super-admin',
};

export const mockHrAdmin: AuthenticatedUser = {
  userId: 'hr-admin-id',
  email: 'hr@test.com',
  tenantId: 'test-tenant',
  role: 'HR_ADMIN' as any,
  employeeId: 'emp-hr-admin',
};

export const mockManager: AuthenticatedUser = {
  userId: 'manager-id',
  email: 'manager@test.com',
  tenantId: 'test-tenant',
  role: 'MANAGER' as any,
  employeeId: 'emp-manager',
};

export const mockEmployee: AuthenticatedUser = {
  userId: 'employee-id',
  email: 'employee@test.com',
  tenantId: 'test-tenant',
  role: 'EMPLOYEE' as any,
  employeeId: 'emp-employee',
};
