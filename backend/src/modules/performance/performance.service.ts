import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateReviewCycleDto,
  UpdateReviewCycleDto,
  ReviewCycleQueryDto,
  SubmitSelfReviewDto,
  SubmitManagerReviewDto,
  ReviewQueryDto,
  CreateGoalDto,
  UpdateGoalDto,
} from './dto/performance.dto';
import {
  ReviewCycleStatus,
  PerformanceReviewStatus,
  GoalStatus,
  EmployeeStatus,
  NotificationType,
  UserRole,
} from '@prisma/client';

@Injectable()
export class PerformanceService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================
  // Review Cycles (HR_ADMIN / SUPER_ADMIN)
  // ============================================

  async getCycles(tenantId: string, query: ReviewCycleQueryDto) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const where: any = { tenantId };

    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.reviewCycle.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { reviews: true } } },
      }),
      this.prisma.reviewCycle.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getCycle(tenantId: string, id: string) {
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { reviews: true } } },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    return cycle;
  }

  async createCycle(tenantId: string, dto: CreateReviewCycleDto) {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }

    return this.prisma.reviewCycle.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
      include: { _count: { select: { reviews: true } } },
    });
  }

  async updateCycle(tenantId: string, id: string, dto: UpdateReviewCycleDto) {
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, tenantId },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status !== ReviewCycleStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT cycles can be edited');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);

    return this.prisma.reviewCycle.update({
      where: { id },
      data,
      include: { _count: { select: { reviews: true } } },
    });
  }

  async deleteCycle(tenantId: string, id: string) {
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, tenantId },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status !== ReviewCycleStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT cycles can be deleted');
    }

    await this.prisma.reviewCycle.delete({ where: { id } });
    return { message: 'Review cycle deleted' };
  }

  async launchCycle(tenantId: string, id: string) {
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, tenantId },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status !== ReviewCycleStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT cycles can be launched');
    }

    // Find all active employees with a manager
    const employees = await this.prisma.employee.findMany({
      where: {
        tenantId,
        status: EmployeeStatus.ACTIVE,
        managerId: { not: null },
      },
      select: { id: true, managerId: true },
    });

    if (employees.length === 0) {
      throw new BadRequestException(
        'No active employees with managers found to create reviews',
      );
    }

    // Create reviews in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.reviewCycle.update({
        where: { id },
        data: { status: ReviewCycleStatus.ACTIVE },
        include: { _count: { select: { reviews: true } } },
      });

      await tx.performanceReview.createMany({
        data: employees.map((emp) => ({
          tenantId,
          cycleId: id,
          employeeId: emp.id,
          reviewerId: emp.managerId!,
        })),
      });

      return updated;
    });

    // Notify all employees (fire-and-forget)
    for (const emp of employees) {
      this.notificationsService
        .notifyEmployee(
          tenantId,
          emp.id,
          NotificationType.REVIEW_CYCLE_LAUNCHED,
          'Performance Review Cycle Launched',
          `A new performance review cycle "${cycle.name}" has been launched. Please complete your self-review.`,
          '/performance',
        )
        .catch(() => {});
    }

    return { ...result, reviewsCreated: employees.length };
  }

  async completeCycle(tenantId: string, id: string) {
    const cycle = await this.prisma.reviewCycle.findFirst({
      where: { id, tenantId },
    });
    if (!cycle) throw new NotFoundException('Review cycle not found');
    if (cycle.status !== ReviewCycleStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE cycles can be completed');
    }

    return this.prisma.reviewCycle.update({
      where: { id },
      data: { status: ReviewCycleStatus.COMPLETED },
      include: { _count: { select: { reviews: true } } },
    });
  }

  // ============================================
  // My Reviews (Employee)
  // ============================================

  async getMyReviews(tenantId: string, employeeId: string, query: ReviewQueryDto) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const where: any = { tenantId, employeeId };

    if (query.status) where.status = query.status;
    if (query.cycleId) where.cycleId = query.cycleId;

    const [data, total] = await Promise.all([
      this.prisma.performanceReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          cycle: { select: { id: true, name: true, startDate: true, endDate: true } },
          reviewer: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { goals: true } },
        },
      }),
      this.prisma.performanceReview.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getReview(tenantId: string, reviewId: string, employeeId: string | undefined, role: UserRole) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: reviewId, tenantId },
      include: {
        cycle: { select: { id: true, name: true, startDate: true, endDate: true } },
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            designation: true,
            department: { select: { name: true } },
          },
        },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
        goals: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!review) throw new NotFoundException('Review not found');

    // Authorization: employee, reviewer, or HR/SUPER_ADMIN can view
    const isAdmin = role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
    if (!isAdmin && review.employeeId !== employeeId && review.reviewerId !== employeeId) {
      throw new ForbiddenException('You do not have access to this review');
    }

    return review;
  }

  async submitSelfReview(
    tenantId: string,
    reviewId: string,
    employeeId: string,
    dto: SubmitSelfReviewDto,
  ) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: reviewId, tenantId, employeeId },
      include: { cycle: { select: { name: true } } },
    });

    if (!review) throw new NotFoundException('Review not found');
    if (review.status !== PerformanceReviewStatus.PENDING) {
      throw new BadRequestException('Self-review can only be submitted for PENDING reviews');
    }

    const updated = await this.prisma.performanceReview.update({
      where: { id: reviewId },
      data: {
        selfRating: dto.selfRating,
        selfComments: dto.selfComments,
        selfSubmittedAt: new Date(),
        status: PerformanceReviewStatus.SELF_REVIEW,
      },
      include: {
        cycle: { select: { id: true, name: true, startDate: true, endDate: true } },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Notify the reviewer
    this.notificationsService
      .notifyEmployee(
        tenantId,
        review.reviewerId,
        NotificationType.REVIEW_SUBMITTED,
        'Self-Review Submitted',
        `An employee has submitted their self-review for "${review.cycle.name}". Please complete the manager review.`,
        '/performance/team',
      )
      .catch(() => {});

    return updated;
  }

  // ============================================
  // Team Reviews (Manager / HR)
  // ============================================

  async getTeamReviews(
    tenantId: string,
    employeeId: string | undefined,
    role: UserRole,
    query: ReviewQueryDto,
  ) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const where: any = { tenantId };

    // Manager only sees their direct reports' reviews
    if (role === UserRole.MANAGER) {
      if (!employeeId) throw new BadRequestException('Employee ID required');
      where.reviewerId = employeeId;
    }

    if (query.status) where.status = query.status;
    if (query.cycleId) where.cycleId = query.cycleId;

    const [data, total] = await Promise.all([
      this.prisma.performanceReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          cycle: { select: { id: true, name: true, startDate: true, endDate: true } },
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              designation: true,
              department: { select: { name: true } },
            },
          },
          reviewer: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { goals: true } },
        },
      }),
      this.prisma.performanceReview.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async submitManagerReview(
    tenantId: string,
    reviewId: string,
    employeeId: string | undefined,
    role: UserRole,
    dto: SubmitManagerReviewDto,
  ) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: reviewId, tenantId },
      include: {
        cycle: { select: { name: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!review) throw new NotFoundException('Review not found');
    if (review.status !== PerformanceReviewStatus.SELF_REVIEW) {
      throw new BadRequestException(
        'Manager review can only be submitted after self-review is completed',
      );
    }

    // Authorization: must be assigned reviewer or HR/SUPER_ADMIN
    const isAdmin = role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
    if (!isAdmin && review.reviewerId !== employeeId) {
      throw new ForbiddenException('You are not the assigned reviewer for this employee');
    }

    const updated = await this.prisma.performanceReview.update({
      where: { id: reviewId },
      data: {
        managerRating: dto.managerRating,
        managerComments: dto.managerComments,
        overallRating: dto.overallRating,
        managerSubmittedAt: new Date(),
        status: PerformanceReviewStatus.COMPLETED,
      },
      include: {
        cycle: { select: { id: true, name: true, startDate: true, endDate: true } },
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            designation: true,
            department: { select: { name: true } },
          },
        },
        reviewer: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Notify the employee
    this.notificationsService
      .notifyEmployee(
        tenantId,
        review.employeeId,
        NotificationType.REVIEW_COMPLETED,
        'Performance Review Completed',
        `Your performance review for "${review.cycle.name}" has been completed. Overall rating: ${dto.overallRating}/5.`,
        '/performance',
      )
      .catch(() => {});

    return updated;
  }

  // ============================================
  // Goals (Employee)
  // ============================================

  async getMyGoals(tenantId: string, employeeId: string) {
    return this.prisma.goal.findMany({
      where: { tenantId, employeeId },
      orderBy: { createdAt: 'desc' },
      include: {
        review: {
          select: {
            id: true,
            status: true,
            cycle: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async createGoal(tenantId: string, employeeId: string, dto: CreateGoalDto) {
    // Verify the review belongs to this employee
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: dto.reviewId, tenantId, employeeId },
    });
    if (!review) {
      throw new BadRequestException('Review not found or does not belong to you');
    }
    if (review.status === PerformanceReviewStatus.COMPLETED) {
      throw new BadRequestException('Cannot add goals to a completed review');
    }

    return this.prisma.goal.create({
      data: {
        tenantId,
        reviewId: dto.reviewId,
        employeeId,
        title: dto.title,
        description: dto.description,
        targetDate: new Date(dto.targetDate),
        weight: dto.weight,
      },
      include: {
        review: {
          select: {
            id: true,
            status: true,
            cycle: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async updateGoal(
    tenantId: string,
    goalId: string,
    employeeId: string,
    dto: UpdateGoalDto,
  ) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId, employeeId },
      include: { review: { select: { status: true } } },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.targetDate !== undefined) data.targetDate = new Date(dto.targetDate);
    if (dto.status !== undefined) data.status = dto.status as GoalStatus;
    if (dto.progress !== undefined) data.progress = dto.progress;
    if (dto.weight !== undefined) data.weight = dto.weight;

    return this.prisma.goal.update({
      where: { id: goalId },
      data,
      include: {
        review: {
          select: {
            id: true,
            status: true,
            cycle: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async deleteGoal(tenantId: string, goalId: string, employeeId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId, employeeId },
      include: { review: { select: { status: true } } },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    if (goal.review.status === PerformanceReviewStatus.COMPLETED) {
      throw new BadRequestException('Cannot delete goals from a completed review');
    }

    await this.prisma.goal.delete({ where: { id: goalId } });
    return { message: 'Goal deleted' };
  }
}
