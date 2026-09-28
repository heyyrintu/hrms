import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { AuthenticatedUser } from '../types/jwt-payload.type';
import { Roles } from '../decorators/roles.decorator';
import { RequirePermissions } from '../permissions/require-permissions.decorator';

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

describe('RolesGuard with @RequirePermissions', () => {
  const guard = new RolesGuard(new Reflector());

  function user(role: UserRole, permissions?: string[]): AuthenticatedUser {
    return { userId: 'u1', email: 'u@test.com', tenantId: 't1', role, permissions };
  }

  function ctx(target: { handler: Function; cls: Function }, u?: AuthenticatedUser): ExecutionContext {
    return {
      getHandler: () => target.handler,
      getClass: () => target.cls,
      switchToHttp: () => ({ getRequest: () => ({ user: u }) }),
    } as unknown as ExecutionContext;
  }

  class PermissionOnly {
    @RequirePermissions('org.manage')
    handler() {}
  }
  class RolesOnly {
    @Roles(UserRole.HR_ADMIN)
    handler() {}
  }
  class Both {
    @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
    @RequirePermissions('org.manage')
    handler() {}
  }
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('audit.view')
  class ClassLevel {
    handler() {}
    @RequirePermissions('org.manage')
    overridden() {}
  }
  class Neither {
    handler() {}
  }

  const on = (cls: any, method = 'handler') => ({ handler: cls.prototype[method], cls });

  it('lets a custom-role permission through a permission-only route', () => {
    expect(guard.canActivate(ctx(on(PermissionOnly), user(UserRole.EMPLOYEE, ['org.manage'])))).toBe(true);
  });

  it('refuses a permission-only route without the permission', () => {
    expect(guard.canActivate(ctx(on(PermissionOnly), user(UserRole.EMPLOYEE, [])))).toBe(false);
    expect(guard.canActivate(ctx(on(PermissionOnly), user(UserRole.EMPLOYEE)))).toBe(false);
    expect(guard.canActivate(ctx(on(PermissionOnly), user(UserRole.HR_ADMIN, ['audit.view'])))).toBe(false);
  });

  it('ignores permissions on a roles-only route (the Wave E case)', () => {
    expect(guard.canActivate(ctx(on(RolesOnly), user(UserRole.EMPLOYEE, ['org.manage'])))).toBe(false);
    expect(guard.canActivate(ctx(on(RolesOnly), user(UserRole.HR_ADMIN)))).toBe(true);
    expect(guard.canActivate(ctx(on(RolesOnly), user(UserRole.MANAGER, ['org.manage'])))).toBe(false);
  });

  it('accepts either the fixed role or the permission when both are declared', () => {
    expect(guard.canActivate(ctx(on(Both), user(UserRole.HR_ADMIN, [])))).toBe(true);
    expect(guard.canActivate(ctx(on(Both), user(UserRole.MANAGER, ['org.manage'])))).toBe(true);
    expect(guard.canActivate(ctx(on(Both), user(UserRole.MANAGER, [])))).toBe(false);
  });

  it('lets a method-level permission override the class-level one', () => {
    const employee = user(UserRole.EMPLOYEE, ['org.manage']);
    expect(guard.canActivate(ctx(on(ClassLevel, 'overridden'), employee))).toBe(true);
    expect(guard.canActivate(ctx(on(ClassLevel), employee))).toBe(false);
    expect(guard.canActivate(ctx(on(ClassLevel), user(UserRole.EMPLOYEE, ['audit.view'])))).toBe(true);
  });

  it('always allows SUPER_ADMIN and allows undecorated routes', () => {
    expect(guard.canActivate(ctx(on(PermissionOnly), user(UserRole.SUPER_ADMIN)))).toBe(true);
    expect(guard.canActivate(ctx(on(Neither), user(UserRole.EMPLOYEE)))).toBe(true);
  });

  it('refuses a permission route with no user on the request', () => {
    expect(guard.canActivate(ctx(on(PermissionOnly), undefined))).toBe(false);
  });
});
