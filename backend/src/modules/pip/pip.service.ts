import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, PIPStatus, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  CreateImprovementPlanDto,
  UpdateImprovementPlanDto,
  AddImprovementPlanGoalDto,
  UpdateImprovementPlanGoalDto,
  ImprovementPlanQueryDto,
} from './dto/pip.dto';

/** Shape returned with every plan so the UI never has to make a second call. */
const PLAN_INCLUDE = {
  employee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      department: { select: { name: true } },
    },
  },
  manager: {
    select: { id: true, firstName: true, lastName: true },
  },
  goals: { orderBy: { targetDate: 'asc' as const } },
};

@Injectable()
export class PipService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================
  // Create
  // ============================================

  /**
   * @param callerEmployeeId the caller's own employee id; undefined for an
   *   account with no employee profile (typically an HR or super admin).
   */
  async create(
    tenantId: string,
    callerEmployeeId: string | undefined,
    role: UserRole,
    dto: CreateImprovementPlanDto,
  ) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);

    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
      select: { id: true, managerId: true },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const managerId = await this.resolvePlanOwner(
      tenantId,
      callerEmployeeId,
      role,
      employee,
      dto.managerId,
    );

    const status = dto.status ?? PIPStatus.DRAFT;

    const plan = await this.prisma.$transaction(async (tx) => {
      const created = await tx.improvementPlan.create({
        data: {
          tenantId,
          employeeId: dto.employeeId,
          managerId,
          title: dto.title,
          description: dto.description,
          startDate,
          endDate,
          status,
        },
      });

      if (dto.goals && dto.goals.length > 0) {
        await tx.improvementPlanGoal.createMany({
          data: dto.goals.map((goal) => ({
            planId: created.id,
            description: goal.description,
            targetDate: new Date(goal.targetDate),
          })),
        });
      }

      return tx.improvementPlan.findUnique({
        where: { id: created.id },
        include: PLAN_INCLUDE,
      });
    });

    // A draft is not yet something the employee should be told about.
    if (status !== PIPStatus.DRAFT) {
      await this.notify(
        tenantId,
        dto.employeeId,
        NotificationType.PIP_CREATED,
        'Performance Improvement Plan',
        `A performance improvement plan "${dto.title}" has been created for you`,
      );
    }

    return plan;
  }

  /**
   * Decides who owns a new plan (`ImprovementPlan.managerId`, a required
   * Employee FK). The owner is never the employee the plan is about.
   *
   * - MANAGER: always themselves, and only for a direct report. They must
   *   have an employee profile, and may not name anyone else.
   * - HR_ADMIN / SUPER_ADMIN: the owner named in the body (an employee of
   *   this tenant); else their own profile; else the subject's reporting
   *   manager; else there is nobody to own it and they must pick someone.
   */
  private async resolvePlanOwner(
    tenantId: string,
    callerEmployeeId: string | undefined,
    role: UserRole,
    subject: { id: string; managerId: string | null },
    requestedOwnerId: string | undefined,
  ): Promise<string> {
    if (role === UserRole.MANAGER) {
      // Guarded explicitly: an undefined id would compare equal to a subject
      // whose managerId is also unset.
      if (!callerEmployeeId) {
        throw new BadRequestException('No employee profile linked to your account');
      }
      if (requestedOwnerId && requestedOwnerId !== callerEmployeeId) {
        throw new ForbiddenException('Managers can only own the plans they raise');
      }
      if (subject.managerId !== callerEmployeeId) {
        throw new ForbiddenException(
          'You can only create improvement plans for your direct reports',
        );
      }
      return callerEmployeeId;
    }

    if (requestedOwnerId) {
      if (requestedOwnerId === subject.id) {
        throw new BadRequestException(
          'The plan owner cannot be the employee the plan is about',
        );
      }
      const owner = await this.prisma.employee.findFirst({
        where: { id: requestedOwnerId, tenantId },
        select: { id: true },
      });
      if (!owner) {
        throw new BadRequestException('Plan owner must be an employee in your organisation');
      }
      return owner.id;
    }

    if (callerEmployeeId && callerEmployeeId !== subject.id) {
      return callerEmployeeId;
    }

    if (subject.managerId && subject.managerId !== subject.id) {
      return subject.managerId;
    }

    throw new BadRequestException(
      'Pick a plan owner: this employee has no reporting manager and your account has no employee profile',
    );
  }

  // ============================================
  // Listing
  // ============================================

  /** HR/admin listing across the whole tenant. */
  async findAll(tenantId: string, query: ImprovementPlanQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;

    return this.paginate(where, query);
  }

  /** Plans raised against the caller. Drafts stay hidden from the employee. */
  async findMine(
    tenantId: string,
    employeeId: string,
    query: ImprovementPlanQueryDto,
  ) {
    // An employee must never see a draft, even by asking for one explicitly.
    if (query.status === PIPStatus.DRAFT) {
      return {
        data: [],
        meta: {
          total: 0,
          page: query.page || 1,
          limit: query.limit || 20,
          totalPages: 0,
        },
      };
    }

    const where: Record<string, unknown> = {
      tenantId,
      employeeId,
      status: query.status ?? { not: PIPStatus.DRAFT },
    };

    return this.paginate(where, query);
  }

  /** Plans the caller owns as the manager. */
  async findTeam(
    tenantId: string,
    managerId: string,
    query: ImprovementPlanQueryDto,
  ) {
    const where: Record<string, unknown> = { tenantId, managerId };
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;

    return this.paginate(where, query);
  }

  private async paginate(
    where: Record<string, unknown>,
    query: ImprovementPlanQueryDto,
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.improvementPlan.findMany({
        where,
        include: PLAN_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.improvementPlan.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ============================================
  // Read one
  // ============================================

  async findById(tenantId: string, id: string, user: AuthenticatedUser) {
    const plan = await this.prisma.improvementPlan.findFirst({
      where: { id, tenantId },
      include: PLAN_INCLUDE,
    });

    if (!plan) {
      throw new NotFoundException('Improvement plan not found');
    }

    if (!this.canView(plan, user)) {
      throw new ForbiddenException(
        'You do not have access to this improvement plan',
      );
    }

    return plan;
  }

  // ============================================
  // Update
  // ============================================

  async update(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
    dto: UpdateImprovementPlanDto,
  ) {
    const existing = await this.getManageablePlan(tenantId, id, user);

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;

    if (endDate <= startDate) {
      throw new BadRequestException('End date must be after start date');
    }

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.startDate !== undefined) data.startDate = startDate;
    if (dto.endDate !== undefined) data.endDate = endDate;
    if (dto.status !== undefined) data.status = dto.status;

    const updated = await this.prisma.improvementPlan.update({
      where: { id },
      data,
      include: PLAN_INCLUDE,
    });

    const statusChanged =
      dto.status !== undefined && dto.status !== existing.status;

    if (statusChanged) {
      // Leaving DRAFT is the moment the plan first exists for the employee.
      const leavingDraft = existing.status === PIPStatus.DRAFT;
      await this.notify(
        tenantId,
        existing.employeeId,
        leavingDraft
          ? NotificationType.PIP_CREATED
          : NotificationType.PIP_UPDATED,
        leavingDraft
          ? 'Performance Improvement Plan'
          : 'Improvement Plan Updated',
        leavingDraft
          ? `A performance improvement plan "${updated.title}" has been created for you`
          : `Your improvement plan "${updated.title}" is now ${dto.status}`,
      );
    }

    return updated;
  }

  // ============================================
  // Goals
  // ============================================

  async addGoal(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
    dto: AddImprovementPlanGoalDto,
  ) {
    await this.getManageablePlan(tenantId, id, user);

    return this.prisma.improvementPlanGoal.create({
      data: {
        planId: id,
        description: dto.description,
        targetDate: new Date(dto.targetDate),
      },
    });
  }

  async updateGoal(
    tenantId: string,
    id: string,
    goalId: string,
    user: AuthenticatedUser,
    dto: UpdateImprovementPlanGoalDto,
  ) {
    const plan = await this.prisma.improvementPlan.findFirst({
      where: { id, tenantId },
    });

    if (!plan) {
      throw new NotFoundException('Improvement plan not found');
    }

    const canManage = this.canManage(plan, user);
    const isOwnPlan = plan.employeeId === user.employeeId;

    if (!canManage && !isOwnPlan) {
      throw new ForbiddenException(
        'You do not have access to this improvement plan',
      );
    }

    // The employee reports progress; only the manager and HR reshape the goal.
    if (
      !canManage &&
      (dto.description !== undefined || dto.targetDate !== undefined)
    ) {
      throw new ForbiddenException(
        'You may only update completion and notes on your own goals',
      );
    }

    const goal = await this.prisma.improvementPlanGoal.findFirst({
      where: { id: goalId, planId: id },
    });

    if (!goal) {
      throw new NotFoundException('Goal not found on this improvement plan');
    }

    const data: Record<string, unknown> = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.targetDate !== undefined) data.targetDate = new Date(dto.targetDate);
    if (dto.notes !== undefined) data.notes = dto.notes;

    if (dto.isCompleted !== undefined) {
      data.isCompleted = dto.isCompleted;
      // completedAt is stamped when the goal is ticked and cleared when unticked.
      data.completedAt = dto.isCompleted ? new Date() : null;
    }

    return this.prisma.improvementPlanGoal.update({
      where: { id: goalId },
      data,
    });
  }

  async deleteGoal(
    tenantId: string,
    id: string,
    goalId: string,
    user: AuthenticatedUser,
  ) {
    await this.getManageablePlan(tenantId, id, user);

    const goal = await this.prisma.improvementPlanGoal.findFirst({
      where: { id: goalId, planId: id },
    });

    if (!goal) {
      throw new NotFoundException('Goal not found on this improvement plan');
    }

    await this.prisma.improvementPlanGoal.delete({ where: { id: goalId } });

    return { message: 'Goal deleted' };
  }

  // ============================================
  // Helpers
  // ============================================

  private isHr(user: AuthenticatedUser) {
    return user.role === UserRole.HR_ADMIN || user.role === UserRole.SUPER_ADMIN;
  }

  private canManage(
    plan: { managerId: string },
    user: AuthenticatedUser,
  ): boolean {
    return this.isHr(user) || plan.managerId === user.employeeId;
  }

  private canView(
    plan: { managerId: string; employeeId: string; status: PIPStatus },
    user: AuthenticatedUser,
  ): boolean {
    if (this.canManage(plan, user)) return true;
    // The employee sees their own plan, but never while it is still a draft.
    return plan.employeeId === user.employeeId && plan.status !== PIPStatus.DRAFT;
  }

  private async getManageablePlan(
    tenantId: string,
    id: string,
    user: AuthenticatedUser,
  ) {
    const plan = await this.prisma.improvementPlan.findFirst({
      where: { id, tenantId },
    });

    if (!plan) {
      throw new NotFoundException('Improvement plan not found');
    }

    if (!this.canManage(plan, user)) {
      throw new ForbiddenException(
        'Only the plan owner or HR can change this improvement plan',
      );
    }

    return plan;
  }

  private async notify(
    tenantId: string,
    employeeId: string,
    type: NotificationType,
    title: string,
    message: string,
  ) {
    await this.notificationsService.notifyEmployee(
      tenantId,
      employeeId,
      type,
      title,
      message,
      '/performance/improvement-plans',
    );
  }
}
