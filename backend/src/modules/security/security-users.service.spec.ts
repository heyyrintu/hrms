import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditAction, UserRole } from '@prisma/client';
import { SecurityUsersService } from './security-users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { createMockPrismaService } from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

describe('SecurityUsersService', () => {
  let service: SecurityUsersService;
  let prisma: any;
  let audit: { log: jest.Mock };

  const tenantId = 'tenant-1';
  const actor: AuthenticatedUser = {
    userId: 'admin-1',
    email: 'admin@test.com',
    tenantId,
    role: UserRole.HR_ADMIN,
  };

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityUsersService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(SecurityUsersService);
    prisma = module.get(PrismaService);
  });

  describe('list', () => {
    it('never selects passwordHash or TOTP columns', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list(tenantId, {});

      const call = prisma.user.findMany.mock.calls[0][0];
      const select = call.select;
      expect(select).toBeDefined();
      expect(select.passwordHash).toBeUndefined();
      expect(select.totpSecretEnc).toBeUndefined();
      expect(select.totpPendingSecretEnc).toBeUndefined();
      expect(call.where).toEqual(expect.objectContaining({ tenantId }));
    });

    it('maps rows and returns paginated meta', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'user-1',
          email: 'jane@test.com',
          role: UserRole.EMPLOYEE,
          isActive: true,
          totpEnabledAt: new Date('2026-01-01T12:00:00Z'),
          employee: { firstName: 'Jane', lastName: 'Doe' },
          customRoles: [{ customRole: { id: 'role-1', name: 'Payroll Lead' } }],
          identities: [{ provider: 'GOOGLE' }],
        },
      ]);
      prisma.user.count.mockResolvedValue(1);

      const result = await service.list(tenantId, { page: 1, limit: 20 });

      expect(result.data).toEqual([
        {
          id: 'user-1',
          email: 'jane@test.com',
          role: UserRole.EMPLOYEE,
          isActive: true,
          employeeName: 'Jane Doe',
          twoFactorEnabled: true,
          customRoles: [{ id: 'role-1', name: 'Payroll Lead' }],
          ssoProviders: ['GOOGLE'],
        },
      ]);
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('searches email and employee name case-insensitively', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list(tenantId, { search: 'jane' });

      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.where.OR).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ email: expect.objectContaining({ contains: 'jane' }) }),
        ]),
      );
    });

    it('clamps limit to a maximum of 100', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.list(tenantId, { limit: 500 });

      const call = prisma.user.findMany.mock.calls[0][0];
      expect(call.take).toBe(100);
    });
  });

  describe('setRoles', () => {
    it('returns 404 when the user is not in the tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.setRoles(tenantId, 'user-1', ['role-1'], actor)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns 400 when an id is not a role of this tenant, naming it', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1', tenantId });
      prisma.customRole.findMany.mockResolvedValue([{ id: 'role-1', name: 'Payroll Lead' }]);

      await expect(
        service.setRoles(tenantId, 'user-1', ['role-1', 'role-missing'], actor),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setRoles(tenantId, 'user-1', ['role-1', 'role-missing'], actor),
      ).rejects.toThrow(/role-missing/);
    });

    it('dedupes ids, replaces the set in one transaction, and audits before/after names', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1', tenantId });
      prisma.customRole.findMany.mockResolvedValue([
        { id: 'role-1', name: 'Payroll Lead' },
        { id: 'role-2', name: 'Recruiter' },
      ]);
      prisma.userCustomRole.findMany.mockResolvedValue([
        { customRole: { name: 'Old Role' } },
      ]);

      const result = await service.setRoles(
        tenantId,
        'user-1',
        ['role-1', 'role-2', 'role-1'],
        actor,
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.userCustomRole.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', tenantId } }),
      );
      expect(prisma.userCustomRole.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              tenantId,
              userId: 'user-1',
              customRoleId: 'role-1',
              assignedById: actor.userId,
            }),
            expect.objectContaining({
              tenantId,
              userId: 'user-1',
              customRoleId: 'role-2',
              assignedById: actor.userId,
            }),
          ]),
        }),
      );
      // deduped: only two rows created, not three
      expect(prisma.userCustomRole.createMany.mock.calls[0][0].data).toHaveLength(2);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.UPDATE,
          entityType: 'UserCustomRole',
          entityId: 'user-1',
          oldValues: { roles: ['Old Role'] },
          newValues: expect.objectContaining({
            roles: expect.arrayContaining(['Payroll Lead', 'Recruiter']),
          }),
        }),
      );

      expect(result).toEqual(
        expect.arrayContaining([
          { id: 'role-1', name: 'Payroll Lead' },
          { id: 'role-2', name: 'Recruiter' },
        ]),
      );
    });

    it('clears all roles when given an empty list', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1', tenantId });
      prisma.userCustomRole.findMany.mockResolvedValue([]);

      const result = await service.setRoles(tenantId, 'user-1', [], actor);

      expect(prisma.userCustomRole.deleteMany).toHaveBeenCalled();
      expect(prisma.userCustomRole.createMany).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });
});
