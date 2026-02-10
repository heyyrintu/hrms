import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { AuthenticatedUser } from '../types/jwt-payload.type';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  function createMockContext(user?: AuthenticatedUser): ExecutionContext {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should allow access when no roles are specified', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when roles array is empty', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([]);

    const context = createMockContext();
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when no user is present on the request', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.HR_ADMIN]);

    const context = createMockContext(undefined);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should always allow access for SUPER_ADMIN regardless of required roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.HR_ADMIN]);

    const superAdmin: AuthenticatedUser = {
      userId: 'super-admin-id',
      email: 'admin@example.com',
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      employeeId: 'emp-1',
    };

    const context = createMockContext(superAdmin);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should allow access when user role matches one of the required roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.HR_ADMIN, UserRole.MANAGER]);

    const hrAdmin: AuthenticatedUser = {
      userId: 'hr-admin-id',
      email: 'hr@example.com',
      tenantId: 'tenant-1',
      role: UserRole.HR_ADMIN,
      employeeId: 'emp-2',
    };

    const context = createMockContext(hrAdmin);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('should deny access when user role does not match any required role', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([UserRole.HR_ADMIN, UserRole.MANAGER]);

    const employee: AuthenticatedUser = {
      userId: 'employee-id',
      email: 'employee@example.com',
      tenantId: 'tenant-1',
      role: UserRole.EMPLOYEE,
      employeeId: 'emp-3',
    };

    const context = createMockContext(employee);
    expect(guard.canActivate(context)).toBe(false);
  });

  it('should call reflector.getAllAndOverride with correct arguments', () => {
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(undefined);

    const context = createMockContext();
    guard.canActivate(context);

    expect(spy).toHaveBeenCalledWith('roles', [
      context.getHandler(),
      context.getClass(),
    ]);
  });
});
