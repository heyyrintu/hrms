import { Injectable } from '@nestjs/common';
import { UserRole, WorkflowEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApprovalStepSnapshot } from './workflow.types';

/** An active user of the tenant, as far as approval routing cares. */
export interface DirectoryUser {
  id: string;
  role: UserRole;
  email: string;
  employeeId: string | null;
  /** Employee name when linked, else the email. */
  name: string;
}

/** The parts of an ApprovalInstance the resolver needs. */
export interface RoutableInstance {
  entityType: WorkflowEntityType;
  requesterEmployeeId: string | null;
  requesterUserId: string | null;
  adminOverride: boolean;
  allowSelfApproval: boolean;
}

/** Who may act on one step, before looking at a particular actor. */
export interface StepResolution {
  /** Users eligible in their own right (after the HR fallback). */
  approvers: Set<string>;
  /**
   * Users eligible only on someone else's behalf (leave cover, delegation):
   * actor user id -> the approver they stand in for.
   */
  onBehalf: Map<string, string>;
}

export interface ActorAccess {
  canAct: boolean;
  /**
   * True when the actor raised the request and may not act on it: always
   * for a non-admin, and for an admin when self-approval is disallowed.
   */
  selfBlocked: boolean;
  onBehalfOfUserId: string | null;
  /** True when the actor can act only through the admin override. */
  isOverride: boolean;
}

const ADMIN_ROLES: UserRole[] = [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN];

export function isAdminRole(role: UserRole): boolean {
  return ADMIN_ROLES.includes(role);
}

/** Today's date as the UTC midnight a `@db.Date` column compares against. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * A per-call snapshot of everything approver resolution reads: the tenant's
 * active users, the manager chain of the requesters, today's active
 * delegations and who is on approved leave today. Built with a fixed number
 * of queries so resolving one instance or five hundred costs the same.
 */
export class ApproverDirectory {
  readonly usersById = new Map<string, DirectoryUser>();
  private readonly userByEmployeeId = new Map<string, DirectoryUser>();

  constructor(
    users: DirectoryUser[],
    /** employeeId -> managerId, for every employee routing may walk through. */
    private readonly managerOf: Map<string, string | null>,
    private readonly delegations: Array<{
      delegatorUserId: string;
      delegateUserId: string;
      entityType: WorkflowEntityType | null;
    }>,
    /** Employees on an APPROVED leave covering today. */
    private readonly onLeaveEmployeeIds: Set<string>,
  ) {
    for (const user of users) {
      this.usersById.set(user.id, user);
      if (user.employeeId) this.userByEmployeeId.set(user.employeeId, user);
    }
  }

  userForEmployee(employeeId: string | null | undefined): DirectoryUser | undefined {
    return employeeId ? this.userByEmployeeId.get(employeeId) : undefined;
  }

  managerIdOf(employeeId: string | null | undefined): string | null {
    if (!employeeId) return null;
    return this.managerOf.get(employeeId) ?? null;
  }

  usersWithRoles(roles: UserRole[]): DirectoryUser[] {
    return [...this.usersById.values()].filter((u) => roles.includes(u.role));
  }

  /** Active delegations (today) of this type, delegate -> delegator. */
  delegationsFor(entityType: WorkflowEntityType) {
    return this.delegations.filter(
      (d) => d.entityType === null || d.entityType === entityType,
    );
  }

  isOnLeave(user: DirectoryUser): boolean {
    return !!user.employeeId && this.onLeaveEmployeeIds.has(user.employeeId);
  }

  nameOf(userId: string): string | null {
    return this.usersById.get(userId)?.name ?? null;
  }
}

@Injectable()
export class ApproverResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load the directory for a tenant. `requesterEmployeeIds` are the
   * employees whose requests will be resolved; their manager chain (two
   * levels) is loaded so MANAGERS_MANAGER can be answered.
   */
  async loadDirectory(
    tenantId: string,
    requesterEmployeeIds: Array<string | null | undefined>,
  ): Promise<ApproverDirectory> {
    const today = todayUtc();

    const [userRows, delegationRows, leaveRows] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId, isActive: true },
        select: {
          id: true,
          role: true,
          email: true,
          employeeId: true,
          employee: { select: { firstName: true, lastName: true, managerId: true } },
        },
      }),
      this.prisma.approvalDelegation.findMany({
        where: {
          tenantId,
          isActive: true,
          startDate: { lte: today },
          endDate: { gte: today },
        },
        select: { delegatorUserId: true, delegateUserId: true, entityType: true },
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          tenantId,
          status: 'APPROVED',
          startDate: { lte: today },
          endDate: { gte: today },
        },
        select: { employeeId: true },
      }),
    ]);

    const managerOf = new Map<string, string | null>();
    const users: DirectoryUser[] = (userRows ?? []).map((u: any) => {
      if (u.employeeId && u.employee) {
        managerOf.set(u.employeeId, u.employee.managerId ?? null);
      }
      const name = u.employee
        ? `${u.employee.firstName} ${u.employee.lastName}`.trim()
        : u.email;
      return {
        id: u.id,
        role: u.role,
        email: u.email,
        employeeId: u.employeeId ?? null,
        name: name || u.email,
      };
    });

    // Requesters (and their managers, for MANAGERS_MANAGER) may have no
    // active user, so read whoever is still unknown from the employee table.
    const requesters = uniq(requesterEmployeeIds);
    await this.loadManagers(tenantId, requesters, managerOf);
    await this.loadManagers(
      tenantId,
      uniq(requesters.map((id) => managerOf.get(id))),
      managerOf,
    );

    return new ApproverDirectory(
      users,
      managerOf,
      delegationRows ?? [],
      new Set((leaveRows ?? []).map((l: any) => l.employeeId)),
    );
  }

  private async loadManagers(
    tenantId: string,
    employeeIds: string[],
    managerOf: Map<string, string | null>,
  ): Promise<void> {
    const unknown = employeeIds.filter((id) => !managerOf.has(id));
    if (unknown.length === 0) return;
    const rows = await this.prisma.employee.findMany({
      where: { tenantId, id: { in: unknown } },
      select: { id: true, managerId: true },
    });
    for (const row of rows ?? []) managerOf.set(row.id, row.managerId ?? null);
  }

  /**
   * Eligible approvers for a step: person- or role-resolved per the step's
   * approver type, falling back to HR when that yields nobody, plus leave
   * cover and delegates acting on an approver's behalf.
   */
  resolve(
    dir: ApproverDirectory,
    instance: RoutableInstance,
    step: ApprovalStepSnapshot,
  ): StepResolution {
    const personApprovers: DirectoryUser[] = [];
    let roleApprovers: DirectoryUser[] = [];

    const reportingManager = () =>
      dir.userForEmployee(dir.managerIdOf(instance.requesterEmployeeId));

    switch (step.approverType) {
      case 'REPORTING_MANAGER': {
        const user = reportingManager();
        if (user) personApprovers.push(user);
        break;
      }
      case 'MANAGERS_MANAGER': {
        const managerId = dir.managerIdOf(instance.requesterEmployeeId);
        const user = dir.userForEmployee(dir.managerIdOf(managerId)) ?? reportingManager();
        if (user) personApprovers.push(user);
        break;
      }
      case 'SPECIFIC_USER': {
        const user = step.approverUserId ? dir.usersById.get(step.approverUserId) : undefined;
        if (user) personApprovers.push(user);
        break;
      }
      case 'HR_ADMIN':
        roleApprovers = dir.usersWithRoles(ADMIN_ROLES);
        break;
      case 'ROLE':
        roleApprovers = step.approverRole ? dir.usersWithRoles([step.approverRole]) : [];
        break;
    }

    if (personApprovers.length === 0 && roleApprovers.length === 0) {
      roleApprovers = dir.usersWithRoles(ADMIN_ROLES);
    }

    const approvers = new Set<string>([
      ...personApprovers.map((u) => u.id),
      ...roleApprovers.map((u) => u.id),
    ]);
    const onBehalf = new Map<string, string>();

    const delegations = dir.delegationsFor(instance.entityType);
    const delegators = new Set(delegations.map((d) => d.delegatorUserId));

    // Leave cover: a person-resolved approver away today, who has not
    // delegated, is covered by their own reporting manager.
    for (const approver of personApprovers) {
      if (!dir.isOnLeave(approver) || delegators.has(approver.id)) continue;
      const cover = dir.userForEmployee(dir.managerIdOf(approver.employeeId));
      if (cover && !approvers.has(cover.id) && !onBehalf.has(cover.id)) {
        onBehalf.set(cover.id, approver.id);
      }
    }

    // Delegation: whoever an eligible approver handed their approvals to.
    for (const d of delegations) {
      if (!approvers.has(d.delegatorUserId)) continue;
      if (approvers.has(d.delegateUserId) || onBehalf.has(d.delegateUserId)) continue;
      if (!dir.usersById.has(d.delegateUserId)) continue;
      onBehalf.set(d.delegateUserId, d.delegatorUserId);
    }

    return { approvers, onBehalf };
  }

  /** Apply the spec's authorization order to one actor. */
  access(
    actor: AuthenticatedUser,
    instance: RoutableInstance,
    resolution: StepResolution,
  ): ActorAccess {
    const denied: ActorAccess = {
      canAct: false,
      selfBlocked: false,
      onBehalfOfUserId: null,
      isOverride: false,
    };

    // A requester who is not HR/SUPER may never act on their own request,
    // whatever route (delegation, leave cover, ROLE, SPECIFIC_USER) makes
    // them eligible. allowSelfApproval only governs admins (payroll
    // maker-checker turns it off).
    if (
      isRequester(actor, instance) &&
      (!isAdminRole(actor.role) || !instance.allowSelfApproval)
    ) {
      return { ...denied, selfBlocked: true };
    }
    if (resolution.approvers.has(actor.userId)) {
      return { ...denied, canAct: true };
    }
    const principal = resolution.onBehalf.get(actor.userId);
    if (principal) {
      return { ...denied, canAct: true, onBehalfOfUserId: principal };
    }
    if (instance.adminOverride && isAdminRole(actor.role)) {
      return { ...denied, canAct: true, isOverride: true };
    }
    return denied;
  }
}

export function isRequester(
  actor: Pick<AuthenticatedUser, 'userId' | 'employeeId'>,
  instance: Pick<RoutableInstance, 'requesterUserId' | 'requesterEmployeeId'>,
): boolean {
  return (
    (!!instance.requesterUserId && actor.userId === instance.requesterUserId) ||
    (!!instance.requesterEmployeeId &&
      !!actor.employeeId &&
      actor.employeeId === instance.requesterEmployeeId)
  );
}

function uniq(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))];
}
