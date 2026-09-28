import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditAction, UserRole } from '@prisma/client';
import { CustomRolesService } from './custom-roles.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { createMockPrismaService } from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

describe('CustomRolesService', () => {
  let service: CustomRolesService;
  let prisma: any;
  let audit: { log: jest.Mock };

  const tenantId = 'tenant-1';
  const actor: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId,
    role: UserRole.HR_ADMIN,
  };

  beforeEach(async () => {
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomRolesService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(CustomRolesService);
    prisma = module.get(PrismaService);
  });

  describe('list', () => {
    it('returns roles scoped to the tenant with userCount from _count', async () => {
      prisma.customRole.findMany.mockResolvedValue([
        {
          id: 'role-1',
          tenantId,
          name: 'Payroll Lead',
          description: 'Manages payroll',
          permissions: ['payroll.statutory.manage'],
          createdAt: new Date('2026-01-01T12:00:00Z'),
          updatedAt: new Date('2026-01-02T12:00:00Z'),
          _count: { users: 3 },
        },
      ]);

      const result = await service.list(tenantId);

      expect(prisma.customRole.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
      expect(result).toEqual([
        {
          id: 'role-1',
          name: 'Payroll Lead',
          description: 'Manages payroll',
          permissions: ['payroll.statutory.manage'],
          userCount: 3,
          createdAt: new Date('2026-01-01T12:00:00Z'),
          updatedAt: new Date('2026-01-02T12:00:00Z'),
        },
      ]);
    });
  });

  describe('create', () => {
    it('trims the name and creates the role', async () => {
      prisma.customRole.create.mockResolvedValue({
        id: 'role-1',
        tenantId,
        name: 'Payroll Lead',
        description: null,
        permissions: ['payroll.statutory.manage'],
        createdAt: new Date('2026-01-01T12:00:00Z'),
        updatedAt: new Date('2026-01-01T12:00:00Z'),
        _count: { users: 0 },
      });

      const result = await service.create(tenantId, actor, {
        name: '  Payroll Lead  ',
        permissions: ['payroll.statutory.manage'],
      });

      expect(prisma.customRole.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            name: 'Payroll Lead',
            permissions: ['payroll.statutory.manage'],
            createdById: actor.userId,
          }),
        }),
      );
      expect(result.userCount).toBe(0);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          userId: actor.userId,
          action: AuditAction.CREATE,
          entityType: 'CustomRole',
          entityId: 'role-1',
        }),
      );
    });

    it('rejects an empty permission list', async () => {
      await expect(
        service.create(tenantId, actor, { name: 'Empty', permissions: [] }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.customRole.create).not.toHaveBeenCalled();
    });

    it('rejects unknown permission keys', async () => {
      await expect(
        service.create(tenantId, actor, { name: 'Bad', permissions: ['not.a.real.permission'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate permission keys', async () => {
      await expect(
        service.create(tenantId, actor, {
          name: 'Dup',
          permissions: ['org.manage', 'org.manage'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('maps a P2002 unique violation to a 409 with a readable message', async () => {
      prisma.customRole.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.create(tenantId, actor, { name: 'Dup Name', permissions: ['org.manage'] }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create(tenantId, actor, { name: 'Dup Name', permissions: ['org.manage'] }),
      ).rejects.toThrow('A role with this name already exists');
    });
  });

  describe('update', () => {
    const existing = {
      id: 'role-1',
      tenantId,
      name: 'Old Name',
      description: 'Old description',
      permissions: ['org.manage'],
      createdAt: new Date('2026-01-01T12:00:00Z'),
      updatedAt: new Date('2026-01-01T12:00:00Z'),
    };

    it('returns 404 for a role belonging to another tenant', async () => {
      prisma.customRole.findFirst.mockResolvedValue(null);

      await expect(
        service.update(tenantId, 'role-1', actor, { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.customRole.findFirst).toHaveBeenCalledWith({
        where: { id: 'role-1', tenantId },
      });
      expect(prisma.customRole.update).not.toHaveBeenCalled();
    });

    it('applies a partial update and audits old/new values', async () => {
      prisma.customRole.findFirst.mockResolvedValue(existing);
      prisma.customRole.update.mockResolvedValue({
        ...existing,
        name: 'New Name',
        _count: { users: 2 },
      });

      const result = await service.update(tenantId, 'role-1', actor, { name: 'New Name' });

      expect(prisma.customRole.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'role-1' },
          data: expect.objectContaining({ name: 'New Name' }),
        }),
      );
      expect(result.name).toBe('New Name');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.UPDATE,
          entityType: 'CustomRole',
          entityId: 'role-1',
          oldValues: expect.objectContaining({ name: 'Old Name' }),
          newValues: expect.objectContaining({ name: 'New Name' }),
        }),
      );
    });

    it('validates permissions on update same as create', async () => {
      prisma.customRole.findFirst.mockResolvedValue(existing);

      await expect(
        service.update(tenantId, 'role-1', actor, { permissions: [] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('returns 404 for a role belonging to another tenant', async () => {
      prisma.customRole.findFirst.mockResolvedValue(null);

      await expect(service.remove(tenantId, 'role-1', actor)).rejects.toThrow(NotFoundException);
      expect(prisma.customRole.delete).not.toHaveBeenCalled();
    });

    it('deletes the role and audits with name and userCount', async () => {
      prisma.customRole.findFirst.mockResolvedValue({
        id: 'role-1',
        tenantId,
        name: 'Payroll Lead',
        _count: { users: 4 },
      });
      prisma.customRole.delete.mockResolvedValue({});

      await service.remove(tenantId, 'role-1', actor);

      expect(prisma.customRole.delete).toHaveBeenCalledWith({ where: { id: 'role-1' } });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.DELETE,
          entityType: 'CustomRole',
          entityId: 'role-1',
          oldValues: expect.objectContaining({ name: 'Payroll Lead', userCount: 4 }),
        }),
      );
    });
  });
});
