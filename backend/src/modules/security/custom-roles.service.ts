import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isPermission } from '../../common/permissions/permissions';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto/custom-role.dto';

interface CustomRoleWithCount {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
  _count: { users: number };
}

export interface CustomRoleView {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Custom role CRUD. Owned by WS-1 (plan Task 1.1). */
@Injectable()
export class CustomRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toView(role: CustomRoleWithCount): CustomRoleView {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: role.permissions,
      userCount: role._count.users,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  private validatePermissions(permissions: string[]): void {
    if (!permissions || permissions.length === 0) {
      throw new BadRequestException('At least one permission is required');
    }
    const unique = new Set(permissions);
    if (unique.size !== permissions.length) {
      throw new BadRequestException('Permission keys must not repeat');
    }
    const unknown = permissions.filter((p) => !isPermission(p));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission keys: ${unknown.join(', ')}`);
    }
  }

  async list(tenantId: string): Promise<CustomRoleView[]> {
    const roles = await this.prisma.customRole.findMany({
      where: { tenantId },
      include: { _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    });
    return roles.map((role: CustomRoleWithCount) => this.toView(role));
  }

  async create(
    tenantId: string,
    actor: AuthenticatedUser,
    dto: CreateCustomRoleDto,
  ): Promise<CustomRoleView> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('Name is required');
    }
    this.validatePermissions(dto.permissions);

    try {
      const role = await this.prisma.customRole.create({
        data: {
          tenantId,
          name,
          description: dto.description,
          permissions: dto.permissions,
          createdById: actor.userId,
        },
        include: { _count: { select: { users: true } } },
      });

      await this.audit.log({
        tenantId,
        userId: actor.userId,
        action: AuditAction.CREATE,
        entityType: 'CustomRole',
        entityId: role.id,
        newValues: { name: role.name, description: role.description, permissions: role.permissions },
      });

      return this.toView(role);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    actor: AuthenticatedUser,
    dto: UpdateCustomRoleDto,
  ): Promise<CustomRoleView> {
    const existing = await this.prisma.customRole.findFirst({ where: { id, tenantId } });
    if (!existing) {
      throw new NotFoundException('Custom role not found');
    }

    const data: { name?: string; description?: string | null; permissions?: string[] } = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) {
        throw new BadRequestException('Name is required');
      }
      data.name = name;
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.permissions !== undefined) {
      this.validatePermissions(dto.permissions);
      data.permissions = dto.permissions;
    }

    try {
      const updated = await this.prisma.customRole.update({
        where: { id },
        data,
        include: { _count: { select: { users: true } } },
      });

      await this.audit.log({
        tenantId,
        userId: actor.userId,
        action: AuditAction.UPDATE,
        entityType: 'CustomRole',
        entityId: id,
        oldValues: {
          name: existing.name,
          description: existing.description,
          permissions: existing.permissions,
        },
        newValues: {
          name: updated.name,
          description: updated.description,
          permissions: updated.permissions,
        },
      });

      return this.toView(updated);
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  async remove(tenantId: string, id: string, actor: AuthenticatedUser): Promise<{ success: true }> {
    const existing = await this.prisma.customRole.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { users: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Custom role not found');
    }

    await this.prisma.customRole.delete({ where: { id } });

    await this.audit.log({
      tenantId,
      userId: actor.userId,
      action: AuditAction.DELETE,
      entityType: 'CustomRole',
      entityId: id,
      oldValues: { name: existing.name, userCount: existing._count.users },
    });

    return { success: true };
  }
}
