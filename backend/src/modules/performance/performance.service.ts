import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  CreateReviewCycleDto,
  UpdateReviewCycleDto,
  ReviewCycleQueryDto,
  SubmitSelfReviewDto,
  SubmitManagerReviewDto,
  ReviewQueryDto,
} from './dto/performance.dto';
import {
  ReviewCycleStatus,
  PerformanceReviewStatus,
  EmployeeStatus,
  NotificationType,
  ReviewAudience,
  UserRole,
} from '@prisma/client';
import { PeerReviewsService } from './peer-reviews/peer-reviews.service';
import { resolveRelation, toReviewView, ViewerRelation } from './review-visibility';
import { validateAnswers } from './review-answers';

const CYCLE_SELECT = {
  id: true,
  name: true,
  startDate: true,
  endDate: true,
  status: true,
  peerFeedbackEnabled: true,
  maxPeers: true,
} as const;

const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  designation: true,
  department: { select: { name: true } },
} as const;

const PERSON_SELECT = { id: true, firstName: true, lastName: true } as const;

/** Answers and competency rows travel with every review response; the mapper decides who sees them. */
const REVIEW_DETAIL_INCLUDE = {
  answers: {
    select: { cycleQuestionId: true, audience: true, rating: true, text: true },
  },
  competencyRatings: {
    select: { id: true, name: true, expectedLevel: true, managerRating: true, comment: true },
    orderBy: { name: 'asc' as const },
  },
};

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private peerReviewsService: PeerReviewsService,
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

  /** The template must exist in the tenant (404) and be active (400). */
  private async assertTemplateUsable(tenantId: string, templateId: string) {
    const template = await this.prisma.reviewTemplate.findFirst({
      where: { id: templateId, tenantId },
    });
    if (!template) throw new NotFoundException('Review template not found');
    if (!template.isActive) {
      throw new BadRequestException('The selected review template is inactive');
    }
  }

  async createCycle(tenantId: string, dto: CreateReviewCycleDto) {
    if (new Date(dto.endDate) <= new Date(dto.startDate)) {
      throw new BadRequestException('End date must be after start date');
    }
    if (dto.templateId) await this.assertTemplateUsable(tenantId, dto.templateId);

    const data: any = {
      tenantId,
      name: dto.name,
      description: dto.description,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
    };
    if (dto.templateId) data.templateId = dto.templateId;
    if (dto.peerFeedbackEnabled !== undefined) data.peerFeedbackEnabled = dto.peerFeedbackEnabled;
    if (dto.maxPeers !== undefined) data.maxPeers = dto.maxPeers;

    return this.prisma.reviewCycle.create({
      data,
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
    if (dto.templateId) await this.assertTemplateUsable(tenantId, dto.templateId);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.templateId !== undefined) data.templateId = dto.templateId;
    if (dto.peerFeedbackEnabled !== undefined) data.peerFeedbackEnabled = dto.peerFeedbackEnabled;
    if (dto.maxPeers !== undefined) data.maxPeers = dto.maxPeers;

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
      select: { id: true, managerId: true, designationId: true },
    });

    if (employees.length === 0) {
      throw new BadRequestException(
        'No active employees with managers found to create reviews',
      );
    }

    // Reviews, question snapshot and competency snapshot commit together.
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.reviewCycle.update({
        where: { id },
        data: { status: ReviewCycleStatus.ACTIVE },
        include: { _count: { select: { reviews: true } } },
      });

      const reviews = await tx.performanceReview.createManyAndReturn({
        data: employees.map((emp) => ({
          tenantId,
          cycleId: id,
          employeeId: emp.id,
          reviewerId: emp.managerId!,
        })),
        select: { id: true, employeeId: true },
      });

      if (cycle.templateId) {
        const entries = await tx.reviewTemplateQuestion.findMany({
          where: { templateId: cycle.templateId, question: { isActive: true } },
          include: { question: true },
          orderBy: { sortOrder: 'asc' },
        });
        if (entries.length > 0) {
          await tx.reviewCycleQuestion.createMany({
            data: entries.map((e) => ({
              tenantId,
              cycleId: id,
              questionId: e.questionId,
              text: e.question.text,
              type: e.question.type,
              audience: e.audience,
              isRequired: e.isRequired,
              sortOrder: e.sortOrder,
            })),
          });
        }
      }

      const designationByEmployee = new Map(
        employees.filter((e) => e.designationId).map((e) => [e.id, e.designationId!]),
      );
      const designationIds = [...new Set(designationByEmployee.values())];
      if (designationIds.length > 0) {
        const mappings = await tx.designationCompetency.findMany({
          where: {
            tenantId,
            designationId: { in: designationIds },
            competency: { isActive: true },
          },
          include: { competency: { select: { id: true, name: true } } },
        });
        const rows = reviews.flatMap((review) => {
          const designationId = designationByEmployee.get(review.employeeId);
          if (!designationId) return [];
          return mappings
            .filter((m) => m.designationId === designationId)
            .map((m) => ({
              tenantId,
              reviewId: review.id,
              competencyId: m.competencyId,
              name: m.competency.name,
              expectedLevel: m.expectedLevel,
            }));
        });
        if (rows.length > 0) {
          await tx.reviewCompetencyRating.createMany({ data: rows });
        }
      }

      return updated;
    });

    // Notify all employees (fire-and-forget)
    for (const emp of employees) {
      this.notify(
        tenantId,
        emp.id,
        NotificationType.REVIEW_CYCLE_LAUNCHED,
        'Performance Review Cycle Launched',
        `A new performance review cycle "${cycle.name}" has been launched. Please complete your self-review.`,
        '/performance',
      );
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

    const updated = await this.prisma.reviewCycle.update({
      where: { id },
      data: { status: ReviewCycleStatus.COMPLETED },
      include: { _count: { select: { reviews: true } } },
    });

    // Results are released now: tell every employee whose review was completed.
    const completed = await this.prisma.performanceReview.findMany({
      where: { cycleId: id, tenantId, status: PerformanceReviewStatus.COMPLETED },
      select: { employeeId: true },
    });
    for (const review of completed) {
      this.notify(
        tenantId,
        review.employeeId,
        NotificationType.REVIEW_RESULTS_RELEASED,
        'Performance review results released',
        `Your results for "${cycle.name}" are now available.`,
        '/performance',
      );
    }

    return updated;
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

    const [rows, total] = await Promise.all([
      this.prisma.performanceReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          cycle: { select: CYCLE_SELECT },
          reviewer: { select: PERSON_SELECT },
          _count: { select: { goals: true } },
          ...REVIEW_DETAIL_INCLUDE,
        },
      }),
      this.prisma.performanceReview.count({ where }),
    ]);

    const data = await Promise.all(rows.map((row) => this.selfView(row)));

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getReview(user: AuthenticatedUser, reviewId: string) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: reviewId, tenantId: user.tenantId },
      include: {
        cycle: { select: CYCLE_SELECT },
        employee: { select: EMPLOYEE_SELECT },
        reviewer: { select: PERSON_SELECT },
        goals: { orderBy: { createdAt: 'asc' } },
        ...REVIEW_DETAIL_INCLUDE,
      },
    });

    if (!review) throw new NotFoundException('Review not found');

    // Strangers get 404, not 403: nothing reveals that the review exists.
    const relation = resolveRelation(review, user);
    if (!relation) throw new NotFoundException('Review not found');

    return this.viewFor(review, relation);
  }

  /** The cycle's question snapshot the viewer may see (SELF: own questions, manager's after release). */
  async getReviewQuestions(user: AuthenticatedUser, reviewId: string) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: reviewId, tenantId: user.tenantId },
      include: { cycle: { select: { status: true } } },
    });
    if (!review) throw new NotFoundException('Review not found');

    const relation = resolveRelation(review, user);
    if (!relation) throw new NotFoundException('Review not found');

    const where: any = { cycleId: review.cycleId, tenantId: user.tenantId };
    if (relation === 'SELF') {
      const released = review.cycle?.status === ReviewCycleStatus.COMPLETED;
      where.audience = {
        in: released
          ? [ReviewAudience.SELF, ReviewAudience.MANAGER]
          : [ReviewAudience.SELF],
      };
    }

    return this.prisma.reviewCycleQuestion.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        text: true,
        type: true,
        audience: true,
        isRequired: true,
        sortOrder: true,
      },
    });
  }

  async submitSelfReview(
    tenantId: string,
    reviewId: string,
    employeeId: string,
    dto: SubmitSelfReviewDto,
  ) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: reviewId, tenantId, employeeId },
      include: { cycle: { select: { id: true, name: true, status: true } } },
    });

    if (!review) throw new NotFoundException('Review not found');
    if (review.cycle.status !== ReviewCycleStatus.ACTIVE) {
      throw new BadRequestException('This review cycle is not active');
    }
    if (review.status !== PerformanceReviewStatus.PENDING) {
      throw new BadRequestException('Self-review can only be submitted for PENDING reviews');
    }

    const questions = await this.prisma.reviewCycleQuestion.findMany({
      where: { cycleId: review.cycleId, tenantId, audience: ReviewAudience.SELF },
    });
    const answers = validateAnswers(questions, dto.answers, ReviewAudience.SELF);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.reviewAnswer.deleteMany({
        where: { reviewId, tenantId, audience: ReviewAudience.SELF },
      });
      if (answers.length > 0) {
        await tx.reviewAnswer.createMany({
          data: answers.map((a) => ({ tenantId, reviewId, ...a })),
        });
      }
      return tx.performanceReview.update({
        where: { id: reviewId },
        data: {
          selfRating: dto.selfRating,
          selfComments: dto.selfComments,
          selfSubmittedAt: new Date(),
          status: PerformanceReviewStatus.SELF_REVIEW,
        },
        include: {
          cycle: { select: CYCLE_SELECT },
          reviewer: { select: PERSON_SELECT },
          ...REVIEW_DETAIL_INCLUDE,
        },
      });
    });

    // Notify the reviewer
    this.notify(
      tenantId,
      review.reviewerId,
      NotificationType.REVIEW_SUBMITTED,
      'Self-Review Submitted',
      `An employee has submitted their self-review for "${review.cycle.name}". Please complete the manager review.`,
      '/performance/team',
    );

    return this.selfView(updated);
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

    const [rows, total] = await Promise.all([
      this.prisma.performanceReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          cycle: { select: CYCLE_SELECT },
          employee: { select: EMPLOYEE_SELECT },
          reviewer: { select: PERSON_SELECT },
          _count: { select: { goals: true } },
          ...REVIEW_DETAIL_INCLUDE,
        },
      }),
      this.prisma.performanceReview.count({ where }),
    ]);

    // Per row: an admin's own review in this list is their SELF view.
    const data: Record<string, unknown>[] = [];
    for (const row of rows) {
      const relation = resolveRelation(row, { employeeId, role });
      if (relation) data.push(await this.viewFor(row, relation));
    }

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
        cycle: { select: { id: true, name: true, status: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        competencyRatings: { select: { id: true } },
      },
    });

    if (!review) throw new NotFoundException('Review not found');

    // Authorization: the assigned reviewer or HR/SUPER_ADMIN, never on one's own review.
    const relation = resolveRelation(review, { employeeId, role });
    if (relation === 'SELF') {
      throw new ForbiddenException('You cannot submit the manager review of your own review');
    }
    if (!relation) {
      throw new ForbiddenException('You are not the assigned reviewer for this employee');
    }

    if (review.cycle.status !== ReviewCycleStatus.ACTIVE) {
      throw new BadRequestException('This review cycle is not active');
    }
    if (review.status !== PerformanceReviewStatus.SELF_REVIEW) {
      throw new BadRequestException(
        'Manager review can only be submitted after self-review is completed',
      );
    }

    const questions = await this.prisma.reviewCycleQuestion.findMany({
      where: { cycleId: review.cycleId, tenantId, audience: ReviewAudience.MANAGER },
    });
    const answers = validateAnswers(questions, dto.answers, ReviewAudience.MANAGER);
    const competencyRatings = this.validateCompetencyRatings(
      review.competencyRatings,
      dto.competencyRatings,
    );

    if (
      dto.potentialRating !== undefined &&
      (!Number.isInteger(dto.potentialRating) || dto.potentialRating < 1 || dto.potentialRating > 3)
    ) {
      throw new BadRequestException('Potential must be a whole number from 1 to 3');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.reviewAnswer.deleteMany({
        where: { reviewId, tenantId, audience: ReviewAudience.MANAGER },
      });
      if (answers.length > 0) {
        await tx.reviewAnswer.createMany({
          data: answers.map((a) => ({ tenantId, reviewId, ...a })),
        });
      }
      for (const c of competencyRatings) {
        await tx.reviewCompetencyRating.update({
          where: { id: c.id },
          data: { managerRating: c.rating, comment: c.comment ?? null },
        });
      }

      const data: any = {
        managerRating: dto.managerRating,
        managerComments: dto.managerComments,
        overallRating: dto.overallRating,
        managerSubmittedAt: new Date(),
        status: PerformanceReviewStatus.COMPLETED,
      };
      if (dto.potentialRating !== undefined) data.potentialRating = dto.potentialRating;

      return tx.performanceReview.update({
        where: { id: reviewId },
        data,
        include: {
          cycle: { select: CYCLE_SELECT },
          employee: { select: EMPLOYEE_SELECT },
          reviewer: { select: PERSON_SELECT },
          ...REVIEW_DETAIL_INCLUDE,
        },
      });
    });

    // Notify the employee. The rating stays hidden until the cycle closes.
    this.notify(
      tenantId,
      review.employeeId,
      NotificationType.REVIEW_COMPLETED,
      'Performance Review Completed',
      'Your manager has completed your review. Results are released when the cycle closes.',
      '/performance',
    );

    return toReviewView(updated, relation);
  }

  /** Reviewer or admin sets the potential rating (1-3) while the cycle is ACTIVE. */
  async setPotential(user: AuthenticatedUser, reviewId: string, potentialRating: number) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: reviewId, tenantId: user.tenantId },
      include: { cycle: { select: { id: true, status: true } } },
    });
    if (!review) throw new NotFoundException('Review not found');

    const relation = resolveRelation(review, user);
    if (relation === 'SELF') {
      throw new ForbiddenException('You cannot set the potential on your own review');
    }
    if (!relation) {
      throw new ForbiddenException('You are not the reviewer of this review');
    }

    if (review.cycle.status !== ReviewCycleStatus.ACTIVE) {
      throw new BadRequestException('Potential can only be set while the review cycle is active');
    }
    if (!Number.isInteger(potentialRating) || potentialRating < 1 || potentialRating > 3) {
      throw new BadRequestException('Potential must be a whole number from 1 to 3');
    }

    const updated = await this.prisma.performanceReview.update({
      where: { id: reviewId },
      data: { potentialRating },
      include: {
        cycle: { select: CYCLE_SELECT },
        employee: { select: EMPLOYEE_SELECT },
        reviewer: { select: PERSON_SELECT },
        ...REVIEW_DETAIL_INCLUDE,
      },
    });
    return toReviewView(updated, relation);
  }

  // ============================================
  // Helpers
  // ============================================

  /** The submitted ratings must cover exactly the review's competency rows, each once. */
  private validateCompetencyRatings(
    rows: Array<{ id: string }>,
    submitted: Array<{ id: string; rating: number; comment?: string }> | undefined,
  ) {
    const given = submitted ?? [];
    const expected = new Set(rows.map((r) => r.id));
    const seen = new Set<string>();

    for (const c of given) {
      if (!expected.has(c.id)) {
        throw new BadRequestException(`Unknown competency rating: ${c.id}`);
      }
      if (seen.has(c.id)) {
        throw new BadRequestException(`Duplicate competency rating: ${c.id}`);
      }
      seen.add(c.id);
      if (!Number.isInteger(c.rating) || c.rating < 1 || c.rating > 5) {
        throw new BadRequestException('Competency ratings must be a whole number from 1 to 5');
      }
    }
    if (seen.size !== expected.size) {
      throw new BadRequestException('Please rate every competency');
    }
    return given;
  }

  /** The employee's view, with the anonymous peer block when 360 is on for the cycle. */
  private async selfView(review: any): Promise<Record<string, unknown>> {
    const view = toReviewView(review, 'SELF');
    if (review.cycle?.peerFeedbackEnabled) {
      Object.assign(
        view,
        await this.peerReviewsService.anonymousFeedback(review.id, view.released as boolean),
      );
    }
    return view;
  }

  private async viewFor(review: any, relation: ViewerRelation): Promise<Record<string, unknown>> {
    if (relation === 'SELF') return this.selfView(review);
    return toReviewView(review, relation);
  }

  /** Fire-and-forget; a failed notification never fails the request. */
  private notify(
    tenantId: string,
    employeeId: string,
    type: NotificationType,
    title: string,
    message: string,
    link: string,
  ) {
    this.notificationsService
      .notifyEmployee(tenantId, employeeId, type, title, message, link)
      .catch((e) => this.logger.warn(`Notification failed: ${e?.message ?? e}`));
  }
}
