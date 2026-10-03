import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  GoalOwnerType,
  GoalStatus,
  KeyResultMetricType,
  PerformanceReviewStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { isAdminRole } from '../performance-rating';
import {
  CreateGoalDto,
  GoalQueryDto,
  KeyResultDto,
  UpdateGoalDto,
  UpdateKeyResultDto,
} from './dto/goals.dto';
import { GoalProgressService, MAX_GOAL_DEPTH, computeKrProgress } from './goal-progress.service';

const NO_EMPLOYEE = 'No employee profile linked to your account';
const LOCKED = 'This review is completed; its goals can no longer be changed';
const DERIVED = 'Progress of this goal is calculated from its key results or aligned goals';

/** Everything the mappers and the access helpers read from a goal row. */
const GOAL_INCLUDE = {
  review: {
    select: {
      id: true,
      status: true,
      cycle: { select: { id: true, name: true } },
    },
  },
  employee: { select: { id: true, firstName: true, lastName: true, managerId: true } },
  department: { select: { id: true, name: true } },
  keyResults: { orderBy: { sortOrder: 'asc' } },
  _count: { select: { children: true } },
} satisfies Prisma.GoalInclude;

type GoalRecord = Prisma.GoalGetPayload<{ include: typeof GOAL_INCLUDE }>;

@Injectable()
export class GoalsService {
  constructor(
    private prisma: PrismaService,
    private goalProgress: GoalProgressService,
  ) {}

  // ============================================
  // Access
  // ============================================

  /** Company and department goals are public; employee goals are owner, manager or admin. */
  private canRead(goal: GoalRecord, user: AuthenticatedUser): boolean {
    if (goal.ownerType !== GoalOwnerType.EMPLOYEE) return true;
    if (isAdminRole(user.role)) return true;
    if (!user.employeeId) return false;
    if (goal.employeeId === user.employeeId) return true;
    return !!goal.employee?.managerId && goal.employee.managerId === user.employeeId;
  }

  /** Admins write company/department goals; the owner writes their own. Admins never write another's goal. */
  private canWrite(goal: GoalRecord, user: AuthenticatedUser): boolean {
    if (goal.ownerType !== GoalOwnerType.EMPLOYEE) return isAdminRole(user.role);
    return !!user.employeeId && goal.employeeId === user.employeeId;
  }

  private isLocked(goal: Pick<GoalRecord, 'review'>): boolean {
    return goal.review?.status === PerformanceReviewStatus.COMPLETED;
  }

  private assertUnlocked(goal: Pick<GoalRecord, 'review'>): void {
    if (this.isLocked(goal)) throw new BadRequestException(LOCKED);
  }

  /** 404 when missing or not visible, 403 when visible but not writable, 400 when locked. */
  private async loadWritable(
    user: AuthenticatedUser,
    goalId: string,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<GoalRecord> {
    const goal = (await db.goal.findFirst({
      where: { id: goalId, tenantId: user.tenantId },
      include: GOAL_INCLUDE,
    })) as GoalRecord | null;
    if (!goal || !this.canRead(goal, user)) throw new NotFoundException('Goal not found');
    if (!this.canWrite(goal, user)) {
      throw new ForbiddenException('You cannot change this goal');
    }
    this.assertUnlocked(goal);
    return goal;
  }

  private hasDerivedProgress(goal: GoalRecord): boolean {
    return goal.keyResults.length > 0 || (goal._count?.children ?? 0) > 0;
  }

  // ============================================
  // Mapping
  // ============================================

  private mapKeyResult(kr: GoalRecord['keyResults'][number]) {
    return {
      ...kr,
      startValue: Number(kr.startValue),
      targetValue: Number(kr.targetValue),
      currentValue: Number(kr.currentValue),
      weight: Number(kr.weight),
    };
  }

  /** Decimals become numbers, the manager link stays server-side, derived/canEdit are computed per caller. */
  private mapGoal(goal: GoalRecord, user: AuthenticatedUser) {
    const { _count, employee, keyResults, ...rest } = goal;
    return {
      ...rest,
      weight: Number(goal.weight),
      employee: employee
        ? { id: employee.id, firstName: employee.firstName, lastName: employee.lastName }
        : null,
      keyResults: keyResults.map((kr) => this.mapKeyResult(kr)),
      isDerived: this.hasDerivedProgress(goal),
      canEdit: this.canWrite(goal, user) && !this.isLocked(goal),
    };
  }

  // ============================================
  // Reads
  // ============================================

  async getMyGoals(user: AuthenticatedUser) {
    return this.list(user, { scope: 'mine' });
  }

  async list(user: AuthenticatedUser, query: Pick<GoalQueryDto, 'scope' | 'departmentId'>) {
    const where = this.scopeWhere(user, query);
    const goals = await this.prisma.goal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: GOAL_INCLUDE,
    });
    return (goals as GoalRecord[]).map((g) => this.mapGoal(g, user));
  }

  /** employeeId is checked before it can reach a `where`: undefined would match every row. */
  private scopeWhere(
    user: AuthenticatedUser,
    query: Pick<GoalQueryDto, 'scope' | 'departmentId'>,
  ): Prisma.GoalWhereInput {
    const tenantId = user.tenantId;
    switch (query.scope) {
      case 'mine':
        if (!user.employeeId) throw new BadRequestException(NO_EMPLOYEE);
        return { tenantId, ownerType: GoalOwnerType.EMPLOYEE, employeeId: user.employeeId };
      case 'team':
        if (isAdminRole(user.role)) return { tenantId, ownerType: GoalOwnerType.EMPLOYEE };
        if (user.role !== UserRole.MANAGER) {
          throw new ForbiddenException('Only managers and admins can view team goals');
        }
        if (!user.employeeId) throw new BadRequestException(NO_EMPLOYEE);
        return {
          tenantId,
          ownerType: GoalOwnerType.EMPLOYEE,
          employee: { managerId: user.employeeId },
        };
      case 'company':
        return { tenantId, ownerType: GoalOwnerType.COMPANY };
      case 'department':
        return {
          tenantId,
          ownerType: GoalOwnerType.DEPARTMENT,
          ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        };
      default:
        throw new BadRequestException('Unknown goal scope');
    }
  }

  async getGoal(user: AuthenticatedUser, goalId: string) {
    const goal = (await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId: user.tenantId },
      include: GOAL_INCLUDE,
    })) as GoalRecord | null;
    if (!goal || !this.canRead(goal, user)) throw new NotFoundException('Goal not found');

    let parent: GoalRecord | null = null;
    if (goal.parentGoalId) {
      parent = (await this.prisma.goal.findFirst({
        where: { id: goal.parentGoalId, tenantId: user.tenantId },
        include: GOAL_INCLUDE,
      })) as GoalRecord | null;
      if (parent && !this.canRead(parent, user)) parent = null;
    }
    const children = (await this.prisma.goal.findMany({
      where: { parentGoalId: goal.id, tenantId: user.tenantId },
      orderBy: { createdAt: 'asc' },
      include: GOAL_INCLUDE,
    })) as GoalRecord[];

    return {
      ...this.mapGoal(goal, user),
      parent: parent ? this.mapGoal(parent, user) : null,
      children: children.filter((c) => this.canRead(c, user)).map((c) => this.mapGoal(c, user)),
    };
  }

  /**
   * Company -> department -> employee forest of the goals the caller may see,
   * built in memory. A node whose parent is not visible becomes a root.
   */
  async tree(user: AuthenticatedUser, rootId?: string) {
    const visible: Prisma.GoalWhereInput[] = [
      { ownerType: { in: [GoalOwnerType.COMPANY, GoalOwnerType.DEPARTMENT] } },
    ];
    if (isAdminRole(user.role)) {
      visible.push({ ownerType: GoalOwnerType.EMPLOYEE });
    } else if (user.employeeId) {
      visible.push({ ownerType: GoalOwnerType.EMPLOYEE, employeeId: user.employeeId });
      visible.push({ ownerType: GoalOwnerType.EMPLOYEE, employee: { managerId: user.employeeId } });
    }
    const goals = (await this.prisma.goal.findMany({
      where: { tenantId: user.tenantId, OR: visible },
      orderBy: { createdAt: 'asc' },
      include: GOAL_INCLUDE,
    })) as GoalRecord[];

    type Node = ReturnType<GoalsService['mapGoal']> & { children: Node[] };
    const nodes = new Map<string, Node>();
    for (const g of goals) nodes.set(g.id, { ...this.mapGoal(g, user), children: [] });

    const roots: Node[] = [];
    for (const g of goals) {
      const node = nodes.get(g.id)!;
      const parent = g.parentGoalId ? nodes.get(g.parentGoalId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    if (rootId) {
      const node = nodes.get(rootId);
      if (!node) throw new NotFoundException('Goal not found');
      return [node];
    }
    return roots;
  }

  // ============================================
  // Alignment
  // ============================================

  /**
   * Checks a proposed parent: visible (404), a permitted pairing (400), and
   * no cycle or over-deep chain (400). `goal.id` is absent on create.
   */
  async validateParent(
    tenantId: string,
    goal: { id?: string; ownerType: GoalOwnerType; employeeId: string | null },
    parentGoalId: string,
    user: AuthenticatedUser,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const parent = (await tx.goal.findFirst({
      where: { id: parentGoalId, tenantId },
      include: GOAL_INCLUDE,
    })) as GoalRecord | null;

    // An employee may align to their own manager's goal, which the read matrix
    // alone would hide from them, so that pairing counts as visible.
    let ownerManagerId: string | null = null;
    if (goal.ownerType === GoalOwnerType.EMPLOYEE && goal.employeeId) {
      const owner = await tx.employee.findFirst({
        where: { id: goal.employeeId, tenantId },
        select: { managerId: true },
      });
      ownerManagerId = owner?.managerId ?? null;
    }
    const managersGoal =
      !!parent &&
      parent.ownerType === GoalOwnerType.EMPLOYEE &&
      !!ownerManagerId &&
      parent.employeeId === ownerManagerId &&
      !!user.employeeId &&
      goal.employeeId === user.employeeId;

    if (!parent || (!this.canRead(parent, user) && !managersGoal)) {
      throw new NotFoundException('Parent goal not found');
    }

    const orgParent =
      parent.ownerType === GoalOwnerType.COMPANY || parent.ownerType === GoalOwnerType.DEPARTMENT;
    let allowed: boolean;
    switch (goal.ownerType) {
      case GoalOwnerType.COMPANY:
        allowed = parent.ownerType === GoalOwnerType.COMPANY;
        break;
      case GoalOwnerType.DEPARTMENT:
        allowed = orgParent;
        break;
      default:
        allowed = orgParent || managersGoal;
    }
    if (!allowed) throw new BadRequestException('This goal cannot be aligned to that parent');

    if (goal.id && parent.id === goal.id) {
      throw new BadRequestException('Alignment would create a cycle');
    }
    let currentId: string | null = parent.parentGoalId;
    for (let hops = 0; currentId; hops++) {
      if (goal.id && currentId === goal.id) {
        throw new BadRequestException('Alignment would create a cycle');
      }
      if (hops >= MAX_GOAL_DEPTH) {
        throw new BadRequestException('Alignment chain is too deep');
      }
      const node: { id: string; parentGoalId: string | null } | null = await tx.goal.findFirst({
        where: { id: currentId, tenantId },
        select: { id: true, parentGoalId: true },
      });
      currentId = node?.parentGoalId ?? null;
    }
  }

  // ============================================
  // Goal writes
  // ============================================

  async createGoal(user: AuthenticatedUser, dto: CreateGoalDto) {
    const tenantId = user.tenantId;
    const ownerType = dto.ownerType ?? GoalOwnerType.EMPLOYEE;

    if (ownerType === GoalOwnerType.EMPLOYEE) {
      if (!user.employeeId) throw new BadRequestException(NO_EMPLOYEE);
      if (dto.departmentId) {
        throw new BadRequestException('Only department goals take a department');
      }
    } else {
      if (!isAdminRole(user.role)) {
        throw new ForbiddenException('Only admins can create company or department goals');
      }
      if (dto.reviewId) {
        throw new BadRequestException('Only employee goals can be linked to a review');
      }
      if (ownerType === GoalOwnerType.DEPARTMENT) {
        if (!dto.departmentId) {
          throw new BadRequestException('A department goal needs a department');
        }
        const department = await this.prisma.department.findFirst({
          where: { id: dto.departmentId, tenantId },
          select: { id: true },
        });
        if (!department) throw new NotFoundException('Department not found');
      } else if (dto.departmentId) {
        throw new BadRequestException('Only department goals take a department');
      }
    }

    if (dto.reviewId) {
      const review = await this.prisma.performanceReview.findFirst({
        where: { id: dto.reviewId, tenantId, employeeId: user.employeeId },
      });
      if (!review) {
        throw new BadRequestException('Review not found or does not belong to you');
      }
      if (review.status === PerformanceReviewStatus.COMPLETED) {
        throw new BadRequestException('Cannot add goals to a completed review');
      }
    }

    const employeeId = ownerType === GoalOwnerType.EMPLOYEE ? (user.employeeId ?? null) : null;

    const goalId = await this.prisma.$transaction(async (tx) => {
      if (dto.parentGoalId) {
        await this.validateParent(tenantId, { ownerType, employeeId }, dto.parentGoalId, user, tx);
      }
      const created = await tx.goal.create({
        data: {
          tenantId,
          ownerType,
          employeeId,
          departmentId: ownerType === GoalOwnerType.DEPARTMENT ? dto.departmentId : null,
          reviewId: dto.reviewId ?? null,
          parentGoalId: dto.parentGoalId ?? null,
          shareOnFeed: dto.shareOnFeed ?? false,
          createdByUserId: user.userId,
          title: dto.title,
          description: dto.description,
          targetDate: new Date(dto.targetDate),
          weight: dto.weight,
        },
      });
      if (created.parentGoalId) {
        await this.goalProgress.recomputeChain(tenantId, created.parentGoalId, tx);
      }
      return created.id;
    });

    return this.reload(user, goalId);
  }

  async updateGoal(user: AuthenticatedUser, goalId: string, dto: UpdateGoalDto) {
    const tenantId = user.tenantId;

    await this.prisma.$transaction(async (tx) => {
      const goal = await this.loadWritable(user, goalId, tx);

      const derived = this.hasDerivedProgress(goal);
      if (derived && (dto.progress !== undefined || dto.status !== undefined)) {
        throw new BadRequestException(DERIVED);
      }

      const data: Prisma.GoalUncheckedUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title;
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.targetDate !== undefined) data.targetDate = new Date(dto.targetDate);
      if (dto.weight !== undefined) data.weight = dto.weight;
      if (dto.shareOnFeed !== undefined) data.shareOnFeed = dto.shareOnFeed;
      if (dto.progress !== undefined) data.progress = dto.progress;

      let becameCompleted = false;
      if (dto.status !== undefined) {
        data.status = dto.status as GoalStatus;
        if (dto.status === GoalStatus.COMPLETED) {
          data.progress = 100;
          data.completedAt = goal.completedAt ?? new Date();
          becameCompleted = goal.status !== GoalStatus.COMPLETED;
        } else if (goal.status === GoalStatus.COMPLETED) {
          data.completedAt = null;
        }
      }

      const parentChanged =
        dto.parentGoalId !== undefined && dto.parentGoalId !== goal.parentGoalId;
      if (parentChanged) {
        if (dto.parentGoalId) {
          await this.validateParent(
            tenantId,
            { id: goal.id, ownerType: goal.ownerType, employeeId: goal.employeeId },
            dto.parentGoalId,
            user,
            tx,
          );
        }
        data.parentGoalId = dto.parentGoalId;
      }

      const updated = (await tx.goal.update({
        where: { id: goalId },
        data,
        include: GOAL_INCLUDE,
      })) as GoalRecord;

      if (becameCompleted) await this.goalProgress.postCompletion(updated, tx);

      await this.goalProgress.recomputeChain(tenantId, goalId, tx);
      if (parentChanged && goal.parentGoalId) {
        await this.goalProgress.recomputeChain(tenantId, goal.parentGoalId, tx);
      }
    });

    return this.reload(user, goalId);
  }

  async deleteGoal(user: AuthenticatedUser, goalId: string) {
    const tenantId = user.tenantId;
    await this.prisma.$transaction(async (tx) => {
      const goal = await this.loadWritable(user, goalId, tx);
      if ((goal._count?.children ?? 0) > 0) {
        throw new BadRequestException('Re-align or delete the child goals first');
      }
      await tx.goal.delete({ where: { id: goalId } });
      if (goal.parentGoalId) {
        await this.goalProgress.recomputeChain(tenantId, goal.parentGoalId, tx);
      }
    });
    return { message: 'Goal deleted' };
  }

  private async reload(user: AuthenticatedUser, goalId: string) {
    const goal = (await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId: user.tenantId },
      include: GOAL_INCLUDE,
    })) as GoalRecord | null;
    if (!goal) throw new NotFoundException('Goal not found');
    return this.mapGoal(goal, user);
  }

  // ============================================
  // Key results
  // ============================================

  /** BOOLEAN key results are always 0 -> 1. */
  private krFields(
    metricType: KeyResultMetricType,
    startValue: number,
    targetValue: number,
    currentValue: number,
  ) {
    const start = metricType === KeyResultMetricType.BOOLEAN ? 0 : startValue;
    const target = metricType === KeyResultMetricType.BOOLEAN ? 1 : targetValue;
    return {
      startValue: start,
      targetValue: target,
      currentValue,
      progress: computeKrProgress({ metricType, startValue: start, targetValue: target, currentValue }),
    };
  }

  async addKeyResult(user: AuthenticatedUser, goalId: string, dto: KeyResultDto) {
    const tenantId = user.tenantId;
    const metricType = dto.metricType ?? KeyResultMetricType.NUMBER;
    const fields = this.krFields(
      metricType,
      dto.startValue ?? 0,
      dto.targetValue,
      dto.currentValue ?? 0,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      await this.loadWritable(user, goalId, tx);
      const kr = await tx.keyResult.create({
        data: {
          tenantId,
          goalId,
          title: dto.title,
          metricType,
          ...fields,
          unit: dto.unit,
          weight: dto.weight,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.goalProgress.recomputeChain(tenantId, goalId, tx);
      return kr;
    });
    return this.mapKeyResult(created as GoalRecord['keyResults'][number]);
  }

  async updateKeyResult(
    user: AuthenticatedUser,
    goalId: string,
    krId: string,
    dto: UpdateKeyResultDto,
  ) {
    const tenantId = user.tenantId;
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.loadWritable(user, goalId, tx);
      const kr = await tx.keyResult.findFirst({ where: { id: krId, goalId, tenantId } });
      if (!kr) throw new NotFoundException('Key result not found');

      const metricType = dto.metricType ?? kr.metricType;
      const fields = this.krFields(
        metricType,
        dto.startValue ?? Number(kr.startValue),
        dto.targetValue ?? Number(kr.targetValue),
        dto.currentValue ?? Number(kr.currentValue),
      );
      const result = await tx.keyResult.update({
        where: { id: krId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          metricType,
          ...fields,
          ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
          ...(dto.weight !== undefined ? { weight: dto.weight } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        },
      });
      await this.goalProgress.recomputeChain(tenantId, goalId, tx);
      return result;
    });
    return this.mapKeyResult(updated as GoalRecord['keyResults'][number]);
  }

  async removeKeyResult(user: AuthenticatedUser, goalId: string, krId: string) {
    const tenantId = user.tenantId;
    await this.prisma.$transaction(async (tx) => {
      await this.loadWritable(user, goalId, tx);
      const kr = await tx.keyResult.findFirst({ where: { id: krId, goalId, tenantId } });
      if (!kr) throw new NotFoundException('Key result not found');
      await tx.keyResult.delete({ where: { id: krId } });
      await this.goalProgress.recomputeChain(tenantId, goalId, tx);
    });
    return { message: 'Key result deleted' };
  }
}
