import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeStatus,
  NotificationType,
  PeerReviewStatus,
  PerformanceReviewStatus,
  Prisma,
  ReviewAudience,
  ReviewCycleStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { MIN_ANONYMOUS_PEER_RESPONSES } from '../performance-rating';
import { resolveRelation, ViewerRelation } from '../review-visibility';
import { validateAnswers } from '../review-answers';
import { AddPeerDto, SubmitPeerFeedbackDto } from './dto/peer-reviews.dto';

const NO_EMPLOYEE = 'No employee profile linked to your account';
const CLOSED = 'Peer feedback is closed';

const PERSON = { id: true, firstName: true, lastName: true } as const;
const CYCLE_FIELDS = {
  id: true,
  name: true,
  status: true,
  peerFeedbackEnabled: true,
  maxPeers: true,
} as const;
const PEER_VISIBLE_STATUSES: PeerReviewStatus[] = [
  PeerReviewStatus.APPROVED,
  PeerReviewStatus.SUBMITTED,
  PeerReviewStatus.DECLINED,
];

/** The employee must not learn who submitted and who declined. */
const mask = (s: PeerReviewStatus): PeerReviewStatus =>
  s === PeerReviewStatus.SUBMITTED || s === PeerReviewStatus.DECLINED
    ? PeerReviewStatus.APPROVED
    : s;

/** Unbiased in-place shuffle (Fisher-Yates). */
function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

type ReviewWithCycle = {
  id: string;
  employeeId: string;
  reviewerId: string;
  status: PerformanceReviewStatus;
  cycle: {
    id: string;
    name: string;
    status: ReviewCycleStatus;
    peerFeedbackEnabled: boolean;
    maxPeers: number;
  };
};

/** 360 peer feedback (spec F5). */
@Injectable()
export class PeerReviewsService {
  private readonly logger = new Logger(PeerReviewsService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================
  // Review-side (employee, reviewer, admin)
  // ============================================

  async listForReview(user: AuthenticatedUser, reviewId: string) {
    const review = await this.loadReview(user.tenantId, reviewId);
    const relation = this.relationOr404(review, user);
    const reviewClosed =
      review.status === PerformanceReviewStatus.COMPLETED ||
      review.cycle.status === ReviewCycleStatus.COMPLETED;

    if (relation === 'SELF') {
      // Answers and comments are never loaded for the employee.
      const rows = await this.prisma.peerReview.findMany({
        where: { reviewId, tenantId: user.tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, peer: { select: PERSON } },
      });
      return rows.map((r) => this.selfRow(r, reviewClosed));
    }

    const rows = await this.prisma.peerReview.findMany({
      where: { reviewId, tenantId: user.tenantId },
      orderBy: { createdAt: 'asc' },
      include: {
        peer: { select: PERSON },
        nominatedBy: { select: PERSON },
        answers: { select: { cycleQuestionId: true, rating: true, text: true } },
      },
    });
    return rows.map((r) => this.fullRow(r, reviewClosed));
  }

  async add(user: AuthenticatedUser, reviewId: string, dto: AddPeerDto) {
    const review = await this.loadReview(user.tenantId, reviewId);
    const relation = this.relationOr404(review, user);
    this.assertOpen(review);

    if (
      relation === 'SELF' &&
      review.status !== PerformanceReviewStatus.PENDING &&
      review.status !== PerformanceReviewStatus.SELF_REVIEW
    ) {
      throw new BadRequestException(
        'Peers can only be nominated before the manager review starts',
      );
    }

    const peer = await this.prisma.employee.findFirst({
      where: { id: dto.peerEmployeeId, tenantId: user.tenantId, status: EmployeeStatus.ACTIVE },
      select: { id: true },
    });
    if (!peer) throw new NotFoundException('Peer not found');
    if (peer.id === review.employeeId) {
      throw new BadRequestException('You cannot ask the reviewed employee for feedback');
    }
    if (peer.id === review.reviewerId) {
      throw new BadRequestException('The reviewer cannot also be a peer');
    }

    const active = await this.prisma.peerReview.count({
      where: { tenantId: user.tenantId, reviewId, status: { not: PeerReviewStatus.REJECTED } },
    });
    if (active >= review.cycle.maxPeers) {
      throw new BadRequestException(
        `A review can have at most ${review.cycle.maxPeers} peers`,
      );
    }

    const existing = await this.prisma.peerReview.findFirst({
      where: { tenantId: user.tenantId, reviewId, peerEmployeeId: peer.id },
    });
    if (existing) {
      throw new ConflictException('This peer has already been added for this review');
    }

    const data: Prisma.PeerReviewUncheckedCreateInput =
      relation === 'SELF'
        ? {
            tenantId: user.tenantId,
            reviewId,
            peerEmployeeId: peer.id,
            status: PeerReviewStatus.NOMINATED,
            nominatedByEmployeeId: user.employeeId,
          }
        : {
            tenantId: user.tenantId,
            reviewId,
            peerEmployeeId: peer.id,
            status: PeerReviewStatus.APPROVED,
            decidedAt: new Date(),
            decidedByUserId: user.userId,
          };

    let created;
    try {
      created = await this.prisma.peerReview.create({
        data,
        include: { peer: { select: PERSON }, nominatedBy: { select: PERSON } },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('This peer has already been added for this review');
      }
      throw e;
    }

    if (relation === 'SELF') {
      this.notify(
        user.tenantId,
        review.reviewerId,
        NotificationType.PEER_NOMINATION_PENDING,
        'Peer nomination awaiting approval',
        `An employee nominated a peer for their "${review.cycle.name}" review. Please approve or reject it.`,
        '/performance/team',
      );
      return this.selfRow(created, false);
    }

    this.notify(
      user.tenantId,
      peer.id,
      NotificationType.PEER_FEEDBACK_REQUESTED,
      'Peer feedback requested',
      `You have been asked to give peer feedback for the "${review.cycle.name}" review cycle.`,
      '/performance/feedback-requests',
    );
    return this.fullRow(created, false);
  }

  async withdraw(user: AuthenticatedUser, reviewId: string, peerReviewId: string) {
    const review = await this.loadReview(user.tenantId, reviewId);
    const relation = this.relationOr404(review, user);
    if (relation !== 'SELF') {
      throw new ForbiddenException('Only the reviewed employee can withdraw a nomination');
    }
    this.assertOpen(review);

    const row = await this.prisma.peerReview.findFirst({
      where: { id: peerReviewId, reviewId, tenantId: user.tenantId },
    });
    if (!row) throw new NotFoundException('Peer nomination not found');
    if (row.status !== PeerReviewStatus.NOMINATED) {
      throw new BadRequestException('Only a pending nomination can be withdrawn');
    }

    await this.prisma.peerReview.delete({ where: { id: peerReviewId } });
    return { message: 'Nomination withdrawn' };
  }

  async decide(
    user: AuthenticatedUser,
    reviewId: string,
    peerReviewId: string,
    approve: boolean,
  ) {
    const review = await this.loadReview(user.tenantId, reviewId);
    const relation = this.relationOr404(review, user);
    if (relation === 'SELF') {
      throw new ForbiddenException('You cannot decide on your own peer nominations');
    }
    this.assertOpen(review);

    const row = await this.prisma.peerReview.findFirst({
      where: { id: peerReviewId, reviewId, tenantId: user.tenantId },
    });
    if (!row) throw new NotFoundException('Peer nomination not found');
    if (row.status !== PeerReviewStatus.NOMINATED) {
      throw new BadRequestException('This nomination has already been decided');
    }

    const updated = await this.prisma.peerReview.update({
      where: { id: peerReviewId },
      data: {
        status: approve ? PeerReviewStatus.APPROVED : PeerReviewStatus.REJECTED,
        decidedAt: new Date(),
        decidedByUserId: user.userId,
      },
      include: {
        peer: { select: PERSON },
        nominatedBy: { select: PERSON },
        answers: { select: { cycleQuestionId: true, rating: true, text: true } },
      },
    });

    if (approve) {
      this.notify(
        user.tenantId,
        row.peerEmployeeId,
        NotificationType.PEER_FEEDBACK_REQUESTED,
        'Peer feedback requested',
        `You have been asked to give peer feedback for the "${review.cycle.name}" review cycle.`,
        '/performance/feedback-requests',
      );
    }
    return this.fullRow(updated, false);
  }

  // ============================================
  // Peer-side (the person asked for feedback)
  // ============================================

  async myRequests(user: AuthenticatedUser) {
    const employeeId = this.requireEmployee(user);
    const rows = await this.prisma.peerReview.findMany({
      where: {
        tenantId: user.tenantId,
        peerEmployeeId: employeeId,
        status: { in: PEER_VISIBLE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
      include: this.requestInclude(),
    });
    if (rows.length === 0) return [];

    const cycleIds = [...new Set(rows.map((r) => r.review.cycleId))];
    const questions = await this.prisma.reviewCycleQuestion.findMany({
      where: { tenantId: user.tenantId, cycleId: { in: cycleIds }, audience: ReviewAudience.PEER },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) =>
      this.requestView(r, questions.filter((q) => q.cycleId === r.review.cycleId)),
    );
  }

  async getRequest(user: AuthenticatedUser, id: string) {
    const row = await this.loadOwnRequest(user, id);
    return this.requestView(row, await this.peerQuestions(user.tenantId, row.review.cycleId));
  }

  async submit(user: AuthenticatedUser, id: string, dto: SubmitPeerFeedbackDto) {
    const row = await this.loadOwnRequest(user, id);
    this.assertRequestOpen(row);

    const overallComment = typeof dto.overallComment === 'string' ? dto.overallComment.trim() : '';
    if (overallComment.length < 1 || overallComment.length > 5000) {
      throw new BadRequestException('Overall comment must be 1 to 5000 characters');
    }

    const questions = await this.peerQuestions(user.tenantId, row.review.cycleId);
    const answers = validateAnswers(questions, dto.answers, ReviewAudience.PEER);

    await this.prisma.$transaction(async (tx) => {
      // The status guard makes a concurrent double-submit lose cleanly.
      const moved = await tx.peerReview.updateMany({
        where: { id, tenantId: user.tenantId, status: PeerReviewStatus.APPROVED },
        data: { status: PeerReviewStatus.SUBMITTED, submittedAt: new Date(), overallComment },
      });
      if (!moved?.count) throw new ConflictException('This request was already answered');

      await tx.peerReviewAnswer.createMany({
        data: answers.map((a) => ({
          tenantId: user.tenantId,
          peerReviewId: id,
          cycleQuestionId: a.cycleQuestionId,
          rating: a.rating,
          text: a.text,
        })),
      });
    });

    return this.getRequest(user, id);
  }

  async decline(user: AuthenticatedUser, id: string) {
    const row = await this.loadOwnRequest(user, id);
    this.assertRequestOpen(row);

    const moved = await this.prisma.peerReview.updateMany({
      where: { id, tenantId: user.tenantId, status: PeerReviewStatus.APPROVED },
      data: { status: PeerReviewStatus.DECLINED },
    });
    if (!moved?.count) throw new ConflictException('This request was already answered');

    return this.getRequest(user, id);
  }

  // ============================================
  // Anonymous block for the reviewed employee
  // ============================================

  /**
   * Peer answers for the reviewed employee: only after release, only with at
   * least MIN_ANONYMOUS_PEER_RESPONSES submissions, grouped per question with
   * every list shuffled and no ids, names or timestamps.
   */
  async anonymousFeedback(reviewId: string, released: boolean) {
    if (!released) {
      return { peerFeedback: null, peerFeedbackHiddenReason: 'NOT_RELEASED' as const };
    }

    const submitted = await this.prisma.peerReview.findMany({
      where: { reviewId, status: PeerReviewStatus.SUBMITTED },
      include: {
        answers: {
          include: {
            cycleQuestion: { select: { id: true, text: true, type: true, sortOrder: true } },
          },
        },
      },
    });
    if (submitted.length < MIN_ANONYMOUS_PEER_RESPONSES) {
      return { peerFeedback: null, peerFeedbackHiddenReason: 'TOO_FEW_RESPONSES' as const };
    }

    const byQuestion = new Map<
      string,
      { text: string; type: string; sortOrder: number; ratings: number[]; texts: string[] }
    >();
    for (const row of submitted) {
      for (const a of row.answers) {
        const q = a.cycleQuestion;
        if (!byQuestion.has(q.id)) {
          byQuestion.set(q.id, { text: q.text, type: q.type, sortOrder: q.sortOrder, ratings: [], texts: [] });
        }
        const bucket = byQuestion.get(q.id)!;
        if (typeof a.rating === 'number') bucket.ratings.push(a.rating);
        if (a.text) bucket.texts.push(a.text);
      }
    }

    const questions = [...byQuestion.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((q) => ({
        text: q.text,
        type: q.type,
        ratings: shuffle(q.ratings),
        texts: shuffle(q.texts),
      }));
    const comments = shuffle(
      submitted.map((r) => r.overallComment).filter((c): c is string => !!c && c.trim().length > 0),
    );

    return { peerFeedback: { submittedCount: submitted.length, questions, comments } };
  }

  // ============================================
  // Helpers
  // ============================================

  private async loadReview(tenantId: string, reviewId: string): Promise<ReviewWithCycle> {
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: reviewId, tenantId },
      include: { cycle: { select: CYCLE_FIELDS } },
    });
    if (!review) throw new NotFoundException('Review not found');
    return review as unknown as ReviewWithCycle;
  }

  private relationOr404(review: ReviewWithCycle, user: AuthenticatedUser): ViewerRelation {
    const relation = resolveRelation(review, user);
    if (!relation) throw new NotFoundException('Review not found');
    return relation;
  }

  /** Writes need an ACTIVE cycle with 360 enabled and a review that is not COMPLETED. */
  private assertOpen(review: ReviewWithCycle) {
    if (
      review.status === PerformanceReviewStatus.COMPLETED ||
      review.cycle.status === ReviewCycleStatus.COMPLETED
    ) {
      throw new BadRequestException(CLOSED);
    }
    if (!review.cycle.peerFeedbackEnabled || review.cycle.status !== ReviewCycleStatus.ACTIVE) {
      throw new BadRequestException('Peer feedback is not available for this review cycle');
    }
  }

  private requireEmployee(user: AuthenticatedUser): string {
    if (!user.employeeId) throw new BadRequestException(NO_EMPLOYEE);
    return user.employeeId;
  }

  private requestInclude() {
    return {
      answers: { select: { cycleQuestionId: true, rating: true, text: true } },
      review: {
        select: {
          id: true,
          status: true,
          cycleId: true,
          employee: { select: PERSON },
          cycle: { select: CYCLE_FIELDS },
        },
      },
    };
  }

  /** The caller's own request; other people's rows are 404. */
  private async loadOwnRequest(user: AuthenticatedUser, id: string) {
    const employeeId = this.requireEmployee(user);
    const row = await this.prisma.peerReview.findFirst({
      where: {
        id,
        tenantId: user.tenantId,
        peerEmployeeId: employeeId,
        status: { in: PEER_VISIBLE_STATUSES },
      },
      include: this.requestInclude(),
    });
    if (!row) throw new NotFoundException('Peer request not found');
    return row;
  }

  private assertRequestOpen(row: {
    status: PeerReviewStatus;
    review: { status: PerformanceReviewStatus; cycle: ReviewWithCycle['cycle'] };
  }) {
    if (row.status !== PeerReviewStatus.APPROVED) {
      throw new BadRequestException('This request has already been answered');
    }
    if (
      row.review.status === PerformanceReviewStatus.COMPLETED ||
      row.review.cycle.status === ReviewCycleStatus.COMPLETED
    ) {
      throw new BadRequestException(CLOSED);
    }
    if (!row.review.cycle.peerFeedbackEnabled || row.review.cycle.status !== ReviewCycleStatus.ACTIVE) {
      throw new BadRequestException('Peer feedback is not available for this review cycle');
    }
  }

  private peerQuestions(tenantId: string, cycleId: string) {
    return this.prisma.reviewCycleQuestion.findMany({
      where: { tenantId, cycleId, audience: ReviewAudience.PEER },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private requestView(
    row: {
      id: string;
      status: PeerReviewStatus;
      overallComment: string | null;
      answers: Array<{ cycleQuestionId: string; rating: number | null; text: string | null }>;
      review: {
        status: PerformanceReviewStatus;
        employee: { id: string; firstName: string; lastName: string };
        cycle: { id: string; name: string; status: ReviewCycleStatus };
      };
    },
    questions: Array<{
      id: string;
      text: string;
      type: string;
      audience: string;
      isRequired: boolean;
      sortOrder: number;
    }>,
  ) {
    return {
      id: row.id,
      status: row.status,
      closed:
        row.status === PeerReviewStatus.APPROVED &&
        (row.review.status === PerformanceReviewStatus.COMPLETED ||
          row.review.cycle.status === ReviewCycleStatus.COMPLETED),
      reviewee: row.review.employee,
      cycle: { id: row.review.cycle.id, name: row.review.cycle.name },
      questions: questions.map((q) => ({
        id: q.id,
        text: q.text,
        type: q.type,
        audience: q.audience,
        isRequired: q.isRequired,
        sortOrder: q.sortOrder,
      })),
      answers: this.peerAnswers(row.answers),
      overallComment: row.overallComment,
    };
  }

  private peerAnswers(
    answers: Array<{ cycleQuestionId: string; rating: number | null; text: string | null }> | undefined,
  ) {
    return (answers ?? []).map((a) => ({
      cycleQuestionId: a.cycleQuestionId,
      audience: ReviewAudience.PEER,
      rating: a.rating,
      text: a.text,
    }));
  }

  /** What the reviewed employee may see of a row. `closed` derives from the masked status so it cannot reveal who answered. */
  private selfRow(
    row: { id: string; status: PeerReviewStatus; peer: { id: string; firstName: string; lastName: string } },
    reviewClosed: boolean,
  ) {
    const status = mask(row.status);
    return {
      id: row.id,
      status,
      closed: status === PeerReviewStatus.APPROVED && reviewClosed,
      peer: row.peer,
    };
  }

  /** What the reviewer and admins see: names, real status, answers, comment. */
  private fullRow(
    row: {
      id: string;
      status: PeerReviewStatus;
      peer: { id: string; firstName: string; lastName: string };
      nominatedBy?: { id: string; firstName: string; lastName: string } | null;
      submittedAt?: Date | null;
      overallComment?: string | null;
      answers?: Array<{ cycleQuestionId: string; rating: number | null; text: string | null }>;
    },
    reviewClosed: boolean,
  ) {
    return {
      id: row.id,
      status: row.status,
      closed: row.status === PeerReviewStatus.APPROVED && reviewClosed,
      peer: row.peer,
      nominatedBy: row.nominatedBy ?? null,
      submittedAt: row.submittedAt ?? null,
      overallComment: row.overallComment ?? null,
      answers: this.peerAnswers(row.answers),
    };
  }

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
      .catch((e) => this.logger.warn(`Peer notification failed: ${e?.message ?? e}`));
  }
}
