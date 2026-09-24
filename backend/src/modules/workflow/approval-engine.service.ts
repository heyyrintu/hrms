import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalInstance,
  NotificationType,
  Prisma,
  WorkflowEntityType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from './workflow-registry.service';
import { WORKFLOW_DEFAULTS } from './workflow.defaults';
import { toNumber } from './workflow.utils';
import {
  ApproverDirectory,
  ApproverResolverService,
  isAdminRole,
  isRequester,
} from './approver-resolver.service';
import {
  ActInput,
  ActOutcome,
  ActResult,
  ApprovalStepSnapshot,
  ApprovalTrailView,
  InboxItem,
  StartApprovalInput,
  TrailStepState,
  UserRef,
  WorkflowEntityContext,
  WorkflowStepConfig,
} from './workflow.types';

export const ALREADY_ACTIONED = 'This request was already actioned';
export const NOT_AWAITING = 'Request not found or not awaiting approval';
export const NOT_AN_APPROVER =
  'You are not an approver for the current step of this request';
export const SELF_APPROVAL = 'You cannot approve a request you raised';
export const PAYROLL_SELF_APPROVAL =
  'The person who computed a payroll run cannot approve it';
export const NO_APPROVAL = 'No approval found for this request';
export const TRAIL_FORBIDDEN = 'You cannot view the approval trail of this request';

/** Cap on PENDING instances read for the inbox / actionable lists. */
const PENDING_SCAN_LIMIT = 500;

/** Room for heavy onFinal bodies (payroll approval writes every payslip). */
const ACT_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 };

const APPROVALS_LINK = '/approvals';

const TYPE_LABELS: Record<WorkflowEntityType, string> = {
  LEAVE: 'Leave request',
  EXPENSE: 'Expense claim',
  LOAN: 'Loan request',
  COMP_OFF: 'Comp-off request',
  REGULARIZATION: 'Attendance regularization',
  PAYROLL_RUN: 'Payroll run',
};

type Db = Prisma.TransactionClient | PrismaService;

/**
 * Keep each step whose conditions hold, renumber 1..n. Exported for the
 * definitions service and tests.
 */
export function resolveSteps(
  steps: WorkflowStepConfig[],
  amount: number | null | undefined,
  days: number | null | undefined,
): ApprovalStepSnapshot[] {
  return steps
    .filter((s) => conditionHolds(s.minAmount, amount) && conditionHolds(s.minDays, days))
    .map((s, i) => ({
      order: i + 1,
      name: s.name,
      approverType: s.approverType,
      approverUserId: s.approverType === 'SPECIFIC_USER' ? (s.approverUserId ?? null) : null,
      approverRole: s.approverType === 'ROLE' ? (s.approverRole ?? null) : null,
    }));
}

function conditionHolds(
  min: number | null | undefined,
  value: number | null | undefined,
): boolean {
  if (min === null || min === undefined) return true;
  if (value === null || value === undefined) return false;
  return value >= min;
}

export function parseSteps(json: Prisma.JsonValue): ApprovalStepSnapshot[] {
  if (!Array.isArray(json)) return [];
  return (json as unknown as ApprovalStepSnapshot[])
    .filter((s) => s && typeof s === 'object' && typeof s.order === 'number')
    .sort((a, b) => a.order - b.order);
}

/**
 * The approval engine. See the spec section "Engine rules".
 */
@Injectable()
export class ApprovalEngineService {
  private readonly logger = new Logger(ApprovalEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly registry: WorkflowRegistry,
    private readonly resolver: ApproverResolverService,
  ) {}

  /** Create (or restart, round + 1) the instance for an entity entering approval. */
  async start(input: StartApprovalInput): Promise<ApprovalInstance> {
    const instance = await this.upsertInstance(input.tx ?? this.prisma, input);
    if (!input.tx) {
      void this.notifyPending(input.tenantId, input.entityType, input.entityId);
    }
    return instance;
  }

  /** Notify the current step's approvers. Never throws (fire-and-forget safe). */
  async notifyPending(
    tenantId: string,
    entityType: WorkflowEntityType,
    entityId: string,
  ): Promise<void> {
    try {
      const instance = await this.findInstance(tenantId, entityType, entityId);
      if (!instance || instance.status !== 'PENDING') return;
      const step = parseSteps(instance.steps).find(
        (s) => s.order === instance.currentStepOrder,
      );
      if (!step) return;

      const dir = await this.resolver.loadDirectory(tenantId, [instance.requesterEmployeeId]);
      const resolution = this.resolver.resolve(dir, instance, step);
      const recipients = new Set<string>([
        ...resolution.approvers,
        ...resolution.onBehalf.keys(),
      ]);
      if (!instance.allowSelfApproval && instance.requesterUserId) {
        recipients.delete(instance.requesterUserId);
      }
      if (recipients.size === 0) return;

      const title = await this.describeTitle(tenantId, entityType, entityId);
      await this.notifications.createMany(
        [...recipients].map((userId) => ({
          tenantId,
          userId,
          type: NotificationType.APPROVAL_REQUIRED,
          title: 'Approval required',
          message: `${title} is waiting for your approval (${step.name}).`,
          link: APPROVALS_LINK,
        })),
      );
    } catch (error) {
      this.logger.warn(
        `Could not notify approvers of ${entityType} ${entityId}: ${(error as Error).message}`,
      );
    }
  }

  /** Authorize the actor for the current step, record the action, advance or finish. */
  async act(input: ActInput): Promise<ActResult> {
    const { tenantId, entityType, entityId, actor, decision, onFinal } = input;

    let instance = await this.findInstance(tenantId, entityType, entityId);
    if (!instance || instance.status !== 'PENDING') {
      instance = await this.recoverInstance(tenantId, entityType, entityId, !!instance);
    }

    const steps = parseSteps(instance.steps);
    const step = steps.find((s) => s.order === instance!.currentStepOrder);
    if (!step) {
      throw new ConflictException(ALREADY_ACTIONED);
    }

    const dir = await this.resolver.loadDirectory(tenantId, [instance.requesterEmployeeId]);
    const access = this.resolver.access(
      actor,
      instance,
      this.resolver.resolve(dir, instance, step),
    );
    if (access.selfBlocked) {
      throw new ForbiddenException(
        entityType === 'PAYROLL_RUN' ? PAYROLL_SELF_APPROVAL : SELF_APPROVAL,
      );
    }
    if (!access.canAct) {
      throw new ForbiddenException(NOT_AN_APPROVER);
    }

    const stepOrder = instance.currentStepOrder;
    const round = instance.round;
    const outcome: ActOutcome =
      decision === 'REJECT'
        ? 'REJECTED'
        : stepOrder >= steps.length
          ? 'APPROVED'
          : 'ADVANCED';
    const instanceId = instance.id;

    await this.prisma.$transaction(async (tx) => {
      const guarded = await tx.approvalInstance.updateMany({
        where: { id: instanceId, status: 'PENDING', currentStepOrder: stepOrder, round },
        data:
          outcome === 'ADVANCED'
            ? { currentStepOrder: stepOrder + 1 }
            : { status: outcome, completedAt: new Date() },
      });
      if (guarded.count === 0) {
        throw new ConflictException(ALREADY_ACTIONED);
      }

      await tx.approvalAction.create({
        data: {
          instanceId,
          round,
          stepOrder,
          action: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          actorUserId: actor.userId,
          onBehalfOfUserId: access.onBehalfOfUserId,
          isOverride: access.isOverride,
          note: input.note?.trim() ? input.note.trim() : null,
        },
      });

      if (outcome !== 'ADVANCED' && onFinal) {
        await onFinal(tx);
      }
    }, ACT_TX_OPTIONS);

    if (outcome === 'ADVANCED') {
      void this.notifyAdvanced(instance, step, steps[stepOrder]);
    }

    return {
      outcome,
      instanceId,
      nextStepOrder: outcome === 'ADVANCED' ? stepOrder + 1 : null,
    };
  }

  /** Mark a PENDING instance CANCELLED. No-op when none or already terminal. */
  async cancel(
    tenantId: string,
    entityType: WorkflowEntityType,
    entityId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db: Db = tx ?? this.prisma;
    await db.approvalInstance.updateMany({
      where: { tenantId, entityType, entityId, status: 'PENDING' },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }

  /** Ids of PENDING entities of this type whose current step the actor may act on. */
  async listActionableEntityIds(
    actor: AuthenticatedUser,
    entityType: WorkflowEntityType,
  ): Promise<string[]> {
    const actionable = await this.actionableFor(actor, entityType);
    return actionable.map((a) => a.instance.entityId);
  }

  /** Cross-type inbox for the actor, newest first. */
  async getInbox(actor: AuthenticatedUser): Promise<InboxItem[]> {
    const actionable = await this.actionableFor(actor);
    if (actionable.length === 0) return [];

    const byType = new Map<WorkflowEntityType, typeof actionable>();
    for (const entry of actionable) {
      const list = byType.get(entry.instance.entityType) ?? [];
      list.push(entry);
      byType.set(entry.instance.entityType, list);
    }

    const items: InboxItem[] = [];
    for (const [entityType, entries] of byType) {
      const handler = this.registry.find(entityType);
      if (!handler) continue;
      let summaries;
      try {
        summaries = await handler.describe(
          actor.tenantId,
          entries.map((e) => e.instance.entityId),
        );
      } catch (error) {
        this.logger.warn(
          `Could not describe ${entityType} approvals: ${(error as Error).message}`,
        );
        continue;
      }
      const summaryById = new Map(summaries.map((s) => [s.entityId, s]));
      for (const { instance, steps, onBehalfOf } of entries) {
        const summary = summaryById.get(instance.entityId);
        if (!summary) continue;
        const step = steps.find((s) => s.order === instance.currentStepOrder);
        items.push({
          instanceId: instance.id,
          entityType,
          entityId: instance.entityId,
          title: summary.title,
          subtitle: summary.subtitle,
          requesterName: summary.requesterName,
          link: summary.link,
          submittedAt: summary.submittedAt,
          currentStepOrder: instance.currentStepOrder,
          totalSteps: steps.length,
          currentStepName: step?.name ?? '',
          onBehalfOf,
        });
      }
    }

    return items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }

  /** Approval trail of one entity (current round). */
  async getTrail(
    actor: AuthenticatedUser,
    entityType: WorkflowEntityType,
    entityId: string,
  ): Promise<ApprovalTrailView> {
    const instance = await this.findInstance(actor.tenantId, entityType, entityId);
    if (!instance) {
      throw new NotFoundException(NO_APPROVAL);
    }

    const steps = parseSteps(instance.steps);
    const actions = await this.prisma.approvalAction.findMany({
      where: { instanceId: instance.id },
      orderBy: { createdAt: 'asc' },
    });

    let canAct = false;
    if (instance.status === 'PENDING') {
      const step = steps.find((s) => s.order === instance.currentStepOrder);
      if (step) {
        const dir = await this.resolver.loadDirectory(actor.tenantId, [
          instance.requesterEmployeeId,
        ]);
        canAct = this.resolver.access(
          actor,
          instance,
          this.resolver.resolve(dir, instance, step),
        ).canAct;
      }
    }

    const hasActed = actions.some(
      (a) => a.actorUserId === actor.userId || a.onBehalfOfUserId === actor.userId,
    );
    if (!canAct && !hasActed && !isAdminRole(actor.role) && !isRequester(actor, instance)) {
      throw new ForbiddenException(TRAIL_FORBIDDEN);
    }

    const roundActions = actions.filter((a) => a.round === instance.round);
    const names = await this.userNames(
      actor.tenantId,
      roundActions.flatMap((a) => [a.actorUserId, a.onBehalfOfUserId]),
    );
    const ref = (userId: string | null): UserRef | null =>
      userId ? { userId, name: names.get(userId) ?? 'Unknown user' } : null;

    return {
      instanceId: instance.id,
      status: instance.status,
      round: instance.round,
      currentStepOrder: instance.currentStepOrder,
      canAct,
      steps: steps.map((step) => {
        const action = [...roundActions].reverse().find((a) => a.stepOrder === step.order);
        let state: TrailStepState;
        if (action) {
          state = action.action;
        } else if (instance.status === 'PENDING') {
          state = step.order === instance.currentStepOrder ? 'PENDING' : 'WAITING';
        } else {
          // Rejected earlier, cancelled, or (impossibly) finished without it.
          state = 'CANCELLED';
        }
        return {
          order: step.order,
          name: step.name,
          approverType: step.approverType,
          state,
          actedBy: action ? ref(action.actorUserId) : null,
          onBehalfOf: action ? ref(action.onBehalfOfUserId) : null,
          isOverride: action?.isOverride ?? false,
          actedAt: action ? action.createdAt.toISOString() : null,
          note: action?.note ?? null,
        };
      }),
    };
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private async findInstance(
    tenantId: string,
    entityType: WorkflowEntityType,
    entityId: string,
    db: Db = this.prisma,
  ): Promise<ApprovalInstance | null> {
    const instance = await db.approvalInstance.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
    });
    return instance && instance.tenantId === tenantId ? instance : null;
  }

  /**
   * No PENDING instance: ask the domain whether the entity is awaiting
   * approval and, if so, (re)start the instance lazily (rows the backfill
   * missed). Otherwise the request was already actioned or does not exist.
   *
   * A terminal (REJECTED / CANCELLED / APPROVED) instance is restarted too,
   * round + 1, when the domain still reports the entity as awaiting
   * approval: the domain row is the source of truth, and a stale instance
   * (e.g. a resubmit path that did not call start()) must not block it.
   * A genuine double-action cannot reach this: the domain row has left its
   * awaiting status, so getContext returns null and we answer 409.
   */
  private async recoverInstance(
    tenantId: string,
    entityType: WorkflowEntityType,
    entityId: string,
    hadInstance: boolean,
  ): Promise<ApprovalInstance> {
    const handler = this.registry.find(entityType);
    const context = handler ? await handler.getContext(tenantId, entityId) : null;
    if (!context) {
      if (hadInstance) throw new ConflictException(ALREADY_ACTIONED);
      throw new NotFoundException(NOT_AWAITING);
    }
    return this.upsertInstance(this.prisma, { tenantId, entityType, entityId, context });
  }

  private async upsertInstance(
    db: Db,
    input: {
      tenantId: string;
      entityType: WorkflowEntityType;
      entityId: string;
      context: WorkflowEntityContext;
    },
  ): Promise<ApprovalInstance> {
    const { tenantId, entityType, entityId, context } = input;
    const definition = await db.workflowDefinition.findUnique({
      where: { tenantId_entityType: { tenantId, entityType } },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });

    const fallback = WORKFLOW_DEFAULTS[entityType];
    const amount = toNumber(context.amount);
    const days = toNumber(context.days);

    const configured: WorkflowStepConfig[] = definition
      ? definition.steps.map((s) => ({
          name: s.name,
          approverType: s.approverType,
          approverUserId: s.approverUserId,
          approverRole: s.approverRole,
          minAmount: toNumber(s.minAmount),
          minDays: toNumber(s.minDays),
        }))
      : fallback.steps;

    let steps = resolveSteps(configured, amount, days);
    if (steps.length === 0) {
      steps = resolveSteps(fallback.steps, amount, days);
    }

    const fields = {
      definitionId: definition?.id ?? null,
      status: 'PENDING' as const,
      currentStepOrder: 1,
      steps: steps as unknown as Prisma.InputJsonValue,
      adminOverride: definition?.adminOverride ?? fallback.adminOverride,
      allowSelfApproval: definition?.allowSelfApproval ?? fallback.allowSelfApproval,
      requesterEmployeeId: context.requesterEmployeeId,
      requesterUserId: context.requesterUserId,
      amount,
      days,
      completedAt: null,
    };

    return db.approvalInstance.upsert({
      where: { entityType_entityId: { entityType, entityId } },
      create: { tenantId, entityType, entityId, round: 1, ...fields },
      update: { tenantId, round: { increment: 1 }, ...fields },
    });
  }

  /** PENDING instances (of one type, or all) the actor can act on without override. */
  private async actionableFor(
    actor: AuthenticatedUser,
    entityType?: WorkflowEntityType,
  ): Promise<
    Array<{
      instance: ApprovalInstance;
      steps: ApprovalStepSnapshot[];
      onBehalfOf: UserRef | null;
    }>
  > {
    const instances = await this.prisma.approvalInstance.findMany({
      where: {
        tenantId: actor.tenantId,
        status: 'PENDING',
        ...(entityType ? { entityType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: PENDING_SCAN_LIMIT,
    });
    if (instances.length === 0) return [];

    const dir: ApproverDirectory = await this.resolver.loadDirectory(
      actor.tenantId,
      instances.map((i) => i.requesterEmployeeId),
    );

    const result: Array<{
      instance: ApprovalInstance;
      steps: ApprovalStepSnapshot[];
      onBehalfOf: UserRef | null;
    }> = [];
    for (const instance of instances) {
      const steps = parseSteps(instance.steps);
      const step = steps.find((s) => s.order === instance.currentStepOrder);
      if (!step) continue;
      const access = this.resolver.access(
        actor,
        instance,
        this.resolver.resolve(dir, instance, step),
      );
      // The inbox lists what is assigned to the actor; items reachable only
      // through the admin override stay on the per-flow pages.
      if (!access.canAct || access.isOverride) continue;
      result.push({
        instance,
        steps,
        onBehalfOf: access.onBehalfOfUserId
          ? {
              userId: access.onBehalfOfUserId,
              name: dir.nameOf(access.onBehalfOfUserId) ?? 'Unknown user',
            }
          : null,
      });
    }
    return result;
  }

  private async notifyAdvanced(
    instance: ApprovalInstance,
    approvedStep: ApprovalStepSnapshot,
    nextStep: ApprovalStepSnapshot | undefined,
  ): Promise<void> {
    try {
      await this.notifyPending(instance.tenantId, instance.entityType, instance.entityId);
      const title = await this.describeTitle(
        instance.tenantId,
        instance.entityType,
        instance.entityId,
        false,
      );
      const message = `${approvedStep.name} approved your ${title}${
        nextStep ? `; it now awaits ${nextStep.name}` : ''
      }.`;
      if (instance.requesterUserId) {
        await this.notifications.create({
          tenantId: instance.tenantId,
          userId: instance.requesterUserId,
          type: NotificationType.APPROVAL_STEP_APPROVED,
          title: 'Approval step completed',
          message,
          link: APPROVALS_LINK,
        });
      } else if (instance.requesterEmployeeId) {
        await this.notifications.notifyEmployee(
          instance.tenantId,
          instance.requesterEmployeeId,
          NotificationType.APPROVAL_STEP_APPROVED,
          'Approval step completed',
          message,
          APPROVALS_LINK,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not send step notifications for ${instance.entityType} ${instance.entityId}: ${(error as Error).message}`,
      );
    }
  }

  /** "Casual Leave · 3 days" when the handler can describe it, else a type label. */
  private async describeTitle(
    tenantId: string,
    entityType: WorkflowEntityType,
    entityId: string,
    withRequester = true,
  ): Promise<string> {
    try {
      const handler = this.registry.find(entityType);
      const [summary] = handler ? await handler.describe(tenantId, [entityId]) : [];
      if (summary) {
        return withRequester && summary.requesterName
          ? `${summary.title} from ${summary.requesterName}`
          : summary.title;
      }
    } catch {
      // Fall through to the generic label.
    }
    return `A ${TYPE_LABELS[entityType].toLowerCase()}`;
  }

  private async userNames(
    tenantId: string,
    userIds: Array<string | null>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        email: true,
        employee: { select: { firstName: true, lastName: true } },
      },
    });
    return new Map(
      users.map((u) => [
        u.id,
        u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.email,
      ]),
    );
  }
}
