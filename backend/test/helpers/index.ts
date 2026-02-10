import { UserRole } from '@prisma/client';

/**
 * Authenticated user shape used by guards/decorators.
 */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  role: UserRole;
  tenantId: string;
  employeeId: string;
}

// ---------------------------------------------------------------------------
// User fixtures
// ---------------------------------------------------------------------------

export const mockSuperAdmin: AuthenticatedUser = {
  userId: 'user-super-1',
  email: 'superadmin@hrms.com',
  role: UserRole.SUPER_ADMIN,
  tenantId: 'tenant-1',
  employeeId: 'emp-super-1',
};

export const mockHrAdmin: AuthenticatedUser = {
  userId: 'user-hr-1',
  email: 'hradmin@company.com',
  role: UserRole.HR_ADMIN,
  tenantId: 'tenant-1',
  employeeId: 'emp-hr-1',
};

export const mockManager: AuthenticatedUser = {
  userId: 'user-mgr-1',
  email: 'manager@company.com',
  role: UserRole.MANAGER,
  tenantId: 'tenant-1',
  employeeId: 'emp-mgr-1',
};

export const mockEmployee: AuthenticatedUser = {
  userId: 'user-emp-1',
  email: 'employee@company.com',
  role: UserRole.EMPLOYEE,
  tenantId: 'tenant-1',
  employeeId: 'emp-1',
};

// ---------------------------------------------------------------------------
// Deep-mocked PrismaService factory
// ---------------------------------------------------------------------------

/**
 * Creates a deeply-mocked PrismaService where every model delegate
 * (e.g. prisma.tenant, prisma.user, ...) is a proxy that returns
 * jest.fn() for any property access (findMany, create, count, ...).
 *
 * Usage:
 *   const prisma = createMockPrismaService();
 *   prisma.tenant.findUnique.mockResolvedValue({ id: '1', ... });
 */
export function createMockPrismaService(): any {
  const modelCache: Record<string, Record<string, jest.Mock>> = {};

  const handler: ProxyHandler<Record<string, any>> = {
    get(_target, prop: string) {
      // $transaction is special -- it executes the callback with the proxy itself
      if (prop === '$transaction') {
        return jest.fn().mockImplementation(async (cb: (tx: any) => any) => {
          // Provide the same proxy as the transactional client
          return cb(proxy);
        });
      }

      // Internal / symbol properties -- just return undefined
      if (typeof prop === 'symbol' || prop.startsWith('_')) {
        return undefined;
      }

      // Return a cached model delegate with jest.fn() methods
      if (!modelCache[prop]) {
        modelCache[prop] = new Proxy(
          {},
          {
            get(_t, method: string) {
              if (!modelCache[prop][method]) {
                modelCache[prop][method] = jest.fn();
              }
              return modelCache[prop][method];
            },
          },
        ) as any;
      }

      return modelCache[prop];
    },
  };

  const proxy = new Proxy({}, handler);
  return proxy;
}
