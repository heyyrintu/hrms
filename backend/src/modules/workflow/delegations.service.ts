import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalDelegation, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { isAdminRole, todayUtc } from './approver-resolver.service';
import { ApproverCandidate, DelegationView } from './workflow.types';
import { CreateDelegationDto } from './dto/create-delegation.dto';

const LIST_LIMIT = 200;
const USER_SEARCH_LIMIT = 20;

const USER_SELECT = {
  id: true,
  email: true,
  role: true,
  employee: { select: { firstName: true, lastName: true } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

function displayName(user: Pick<UserRow, 'email' | 'employee'>): string {
  const name = user.employee
    ? `${user.employee.firstName} ${user.employee.lastName}`.trim()
    : '';
  return name || user.email;
}

/** "2026-10-01" -> UTC midnight, the form a `@db.Date` column stores. */
function parseDateOnly(value: string, field: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) throw new BadRequestException(`${field} must be a date (YYYY-MM-DD)`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new BadRequestException(`${field} is not a valid date`);
  }
  return date;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Approvers handing their approvals to someone else for a date range. */
@Injectable()
export class DelegationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    actor: AuthenticatedUser,
    all = false,
  ): Promise<{ given: DelegationView[]; received: DelegationView[] }> {
    const tenantId = actor.tenantId;
    const orderBy = { startDate: 'desc' } as const;
    const listAll = all && isAdminRole(actor.role);

    const [given, received] = await Promise.all([
      this.prisma.approvalDelegation.findMany({
        where: listAll ? { tenantId } : { tenantId, delegatorUserId: actor.userId },
        orderBy,
        take: LIST_LIMIT,
      }),
      this.prisma.approvalDelegation.findMany({
        where: { tenantId, delegateUserId: actor.userId },
        orderBy,
        take: LIST_LIMIT,
      }),
    ]);

    const names = await this.names(tenantId, [...given, ...received]);
    return {
      given: given.map((d) => this.toView(d, names)),
      received: received.map((d) => this.toView(d, names)),
    };
  }

  async create(actor: AuthenticatedUser, dto: CreateDelegationDto): Promise<DelegationView> {
    const tenantId = actor.tenantId;
    let delegatorUserId = actor.userId;
    if (dto.delegatorUserId && dto.delegatorUserId !== actor.userId) {
      if (!isAdminRole(actor.role)) {
        throw new ForbiddenException('Only HR can create a delegation for someone else');
      }
      delegatorUserId = dto.delegatorUserId;
    }

    if (dto.delegateUserId === delegatorUserId) {
      throw new BadRequestException('You cannot delegate approvals to yourself');
    }

    const startDate = parseDateOnly(dto.startDate, 'startDate');
    const endDate = parseDateOnly(dto.endDate, 'endDate');
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        id: { in: [...new Set([delegatorUserId, dto.delegateUserId])] },
      },
      select: { id: true },
    });
    const active = new Set(users.map((u) => u.id));
    if (!active.has(dto.delegateUserId)) {
      throw new BadRequestException('The delegate must be an active user in this organisation');
    }
    if (!active.has(delegatorUserId)) {
      throw new BadRequestException('The delegator must be an active user in this organisation');
    }

    const created = await this.prisma.approvalDelegation.create({
      data: {
        tenantId,
        delegatorUserId,
        delegateUserId: dto.delegateUserId,
        entityType: dto.entityType ?? null,
        startDate,
        endDate,
        reason: dto.reason?.trim() || null,
        isActive: true,
        createdById: actor.userId,
      },
    });
    return this.toView(created, await this.names(tenantId, [created]));
  }

  async cancel(actor: AuthenticatedUser, id: string): Promise<DelegationView> {
    const delegation = await this.prisma.approvalDelegation.findFirst({
      where: { id, tenantId: actor.tenantId },
    });
    if (!delegation) {
      throw new NotFoundException('Delegation not found');
    }
    if (delegation.delegatorUserId !== actor.userId && !isAdminRole(actor.role)) {
      throw new ForbiddenException('Only the delegator or HR can cancel a delegation');
    }
    const updated = await this.prisma.approvalDelegation.update({
      where: { id: delegation.id },
      data: { isActive: false },
    });
    return this.toView(updated, await this.names(actor.tenantId, [updated]));
  }

  /** Active users of the tenant, for approver / delegate pickers. */
  async searchUsers(tenantId: string, search?: string): Promise<ApproverCandidate[]> {
    const term = search?.trim();
    const where: Prisma.UserWhereInput = { tenantId, isActive: true };
    if (term) {
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { employee: { firstName: { contains: term, mode: 'insensitive' } } },
        { employee: { lastName: { contains: term, mode: 'insensitive' } } },
      ];
    }
    const users = await this.prisma.user.findMany({
      where,
      select: USER_SELECT,
      orderBy: { email: 'asc' },
      take: USER_SEARCH_LIMIT,
    });
    return users.map((u) => ({
      id: u.id,
      name: displayName(u),
      email: u.email,
      role: u.role,
    }));
  }

  private async names(
    tenantId: string,
    delegations: ApprovalDelegation[],
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(delegations.flatMap((d) => [d.delegatorUserId, d.delegateUserId])),
    ];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { tenantId, id: { in: ids } },
      select: USER_SELECT,
    });
    return new Map(users.map((u) => [u.id, displayName(u)]));
  }

  private toView(d: ApprovalDelegation, names: Map<string, string>): DelegationView {
    const today = todayUtc();
    return {
      id: d.id,
      delegator: { userId: d.delegatorUserId, name: names.get(d.delegatorUserId) ?? 'Unknown user' },
      delegate: { userId: d.delegateUserId, name: names.get(d.delegateUserId) ?? 'Unknown user' },
      entityType: d.entityType,
      startDate: dateOnly(d.startDate),
      endDate: dateOnly(d.endDate),
      reason: d.reason,
      isActive: d.isActive,
      isCurrent: d.isActive && d.startDate <= today && d.endDate >= today,
    };
  }
}
