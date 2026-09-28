import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ListSecurityUsersQueryDto } from './dto/security-users.dto';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface SecurityUserRow {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  employeeName: string | null;
  twoFactorEnabled: boolean;
  customRoles: { id: string; name: string }[];
  ssoProviders: string[];
}

export interface SecurityUserListResult {
  data: SecurityUserRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** User list for security admin and custom-role assignment. Owned by WS-1 (plan Task 1.2). */
@Injectable()
export class SecurityUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query: ListSecurityUsersQueryDto): Promise<SecurityUserListResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

    const search = query.search?.trim();
    const where: Record<string, unknown> = {
      tenantId,
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { employee: { firstName: { contains: search, mode: 'insensitive' } } },
              { employee: { lastName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const select = {
      id: true,
      email: true,
      role: true,
      isActive: true,
      totpEnabledAt: true,
      employee: { select: { firstName: true, lastName: true } },
      customRoles: { select: { customRole: { select: { id: true, name: true } } } },
      identities: { select: { provider: true } },
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select,
        orderBy: { email: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const data: SecurityUserRow[] = rows.map((row: any) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      isActive: row.isActive,
      employeeName: row.employee ? `${row.employee.firstName} ${row.employee.lastName}` : null,
      twoFactorEnabled: !!row.totpEnabledAt,
      customRoles: row.customRoles.map((cr: any) => cr.customRole),
      ssoProviders: [...new Set<string>(row.identities.map((i: any) => i.provider as string))],
    }));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 0 },
    };
  }

  async setRoles(
    tenantId: string,
    userId: string,
    customRoleIds: string[],
    actor: AuthenticatedUser,
  ): Promise<{ id: string; name: string }[]> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const uniqueIds = [...new Set(customRoleIds)];

    let roles: { id: string; name: string }[] = [];
    if (uniqueIds.length > 0) {
      roles = await this.prisma.customRole.findMany({
        where: { id: { in: uniqueIds }, tenantId },
        select: { id: true, name: true },
      });
      const foundIds = new Set(roles.map((r) => r.id));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`Unknown custom role ids: ${missing.join(', ')}`);
      }
    }

    const before = await this.prisma.userCustomRole.findMany({
      where: { userId, tenantId },
      select: { customRole: { select: { name: true } } },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.userCustomRole.deleteMany({ where: { userId, tenantId } });
      if (uniqueIds.length > 0) {
        await tx.userCustomRole.createMany({
          data: uniqueIds.map((customRoleId) => ({
            tenantId,
            userId,
            customRoleId,
            assignedById: actor.userId,
          })),
        });
      }
    });

    await this.audit.log({
      tenantId,
      userId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'UserCustomRole',
      entityId: userId,
      oldValues: { roles: before.map((b: any) => b.customRole.name) },
      newValues: { roles: roles.map((r) => r.name) },
    });

    return roles;
  }
}
