import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { PeerReviewsService } from './peer-reviews.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../../test/helpers';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { MIN_ANONYMOUS_PEER_RESPONSES } from '../performance-rating';

const T = 'tenant-1';

const user = (role: UserRole, employeeId: string | undefined, userId = `u-${employeeId}`): AuthenticatedUser => ({
  userId,
  email: `${userId}@test.com`,
  tenantId: T,
  role,
  employeeId,
});

const self = user(UserRole.EMPLOYEE, 'emp-1');
const reviewer = user(UserRole.MANAGER, 'emp-mgr');
const admin = user(UserRole.HR_ADMIN, 'emp-hr', 'u-hr');
const stranger = user(UserRole.EMPLOYEE, 'emp-x');
const peerUser = user(UserRole.EMPLOYEE, 'emp-peer');
const noEmployee = user(UserRole.EMPLOYEE, undefined, 'u-none');

const cycle = (over: Record<string, any> = {}) => ({
  id: 'c1',
  name: 'Q1',
  status: 'ACTIVE',
  peerFeedbackEnabled: true,
  maxPeers: 3,
  ...over,
});

const review = (over: Record<string, any> = {}) => ({
  id: 'rev-1',
  tenantId: T,
  cycleId: 'c1',
  employeeId: 'emp-1',
  reviewerId: 'emp-mgr',
  status: 'SELF_REVIEW',
  cycle: cycle(),
  ...over,
});

const name = (id: string) => ({ id, firstName: id, lastName: 'L' });

/** Collects every key at any depth. */
function allKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      allKeys(v, out);
    }
  }
  return out;
}

describe('PeerReviewsService', () => {
  let service: PeerReviewsService;
  let prisma: any;
  let notifications: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeerReviewsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();
    service = module.get(PeerReviewsService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
    prisma.peerReview.updateMany.mockResolvedValue({ count: 1 });
  });

  // ============================================
  // Common gates
  // ============================================

  describe('common gates (add used as the probe)', () => {
    it('404s when the review is missing', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(NotFoundException);
      expect(prisma.performanceReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rev-1', tenantId: T } }),
      );
    });

    it('404s for a stranger (no existence leak)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review());
      await expect(service.add(stranger, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(NotFoundException);
    });

    it('400s when the cycle has peer feedback disabled', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ cycle: cycle({ peerFeedbackEnabled: false }) }));
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(BadRequestException);
    });

    it('400s when the cycle is not ACTIVE (DRAFT)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ cycle: cycle({ status: 'DRAFT' }) }));
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(BadRequestException);
    });

    it("400s 'Peer feedback is closed' once the review is COMPLETED", async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ status: 'COMPLETED' }));
      await expect(service.add(reviewer, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(
        'Peer feedback is closed',
      );
    });

    it('400s once the cycle is COMPLETED (Review Focus 4)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ cycle: cycle({ status: 'COMPLETED' }) }));
      await expect(service.add(admin, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(BadRequestException);
      await expect(service.decide(admin, 'rev-1', 'pr-1', true)).rejects.toThrow(BadRequestException);
      await expect(service.withdraw(self, 'rev-1', 'pr-1')).rejects.toThrow(BadRequestException);
      expect(prisma.peerReview.create).not.toHaveBeenCalled();
      expect(prisma.peerReview.delete).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // add
  // ============================================

  describe('add', () => {
    beforeEach(() => {
      prisma.performanceReview.findFirst.mockResolvedValue(review());
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-peer' });
      prisma.peerReview.count.mockResolvedValue(0);
      prisma.peerReview.findFirst.mockResolvedValue(null);
      prisma.peerReview.create.mockImplementation(async ({ data }: any) => ({
        id: 'pr-1',
        ...data,
        peer: name(data.peerEmployeeId),
        nominatedBy: data.nominatedByEmployeeId ? name(data.nominatedByEmployeeId) : null,
        answers: [],
        submittedAt: null,
        overallComment: null,
      }));
    });

    it('SELF nominates: NOMINATED, nominatedByEmployeeId=self, reviewer notified', async () => {
      const result: any = await service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' });

      expect(prisma.peerReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            tenantId: T,
            reviewId: 'rev-1',
            peerEmployeeId: 'emp-peer',
            status: 'NOMINATED',
            nominatedByEmployeeId: 'emp-1',
          },
        }),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        T, 'emp-mgr', 'PEER_NOMINATION_PENDING', expect.any(String), expect.any(String), '/performance/team',
      );
      // employee-shaped row: no nominatedBy/answers
      expect(result).toEqual({ id: 'pr-1', status: 'NOMINATED', closed: false, peer: name('emp-peer') });
    });

    it('SELF may nominate while PENDING too', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ status: 'PENDING' }));
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).resolves.toBeDefined();
    });

    it('SELF cannot nominate once the manager review has started', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ status: 'MANAGER_REVIEW' }));
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['reviewer', reviewer],
      ['admin', admin],
    ])('%s adds an APPROVED row with decidedAt/decidedByUserId and notifies the peer', async (_n, actor) => {
      const result: any = await service.add(actor, 'rev-1', { peerEmployeeId: 'emp-peer' });

      expect(prisma.peerReview.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            tenantId: T,
            reviewId: 'rev-1',
            peerEmployeeId: 'emp-peer',
            status: 'APPROVED',
            decidedAt: expect.any(Date),
            decidedByUserId: actor.userId,
          },
        }),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        T, 'emp-peer', 'PEER_FEEDBACK_REQUESTED', expect.any(String), expect.any(String),
        '/performance/feedback-requests',
      );
      expect(result.status).toBe('APPROVED');
      expect(result.peer).toEqual(name('emp-peer'));
    });

    it('reviewer/admin may add even after the review reached MANAGER_REVIEW', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ status: 'MANAGER_REVIEW' }));
      await expect(service.add(reviewer, 'rev-1', { peerEmployeeId: 'emp-peer' })).resolves.toBeDefined();
    });

    it('404s when the peer is not an ACTIVE employee of the tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(NotFoundException);
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'emp-peer', tenantId: T, status: 'ACTIVE' },
        select: { id: true },
      });
    });

    it('400s when the peer is the reviewed employee', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1' });
      await expect(service.add(reviewer, 'rev-1', { peerEmployeeId: 'emp-1' })).rejects.toThrow(BadRequestException);
    });

    it('400s when the peer is the reviewer', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-mgr' });
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-mgr' })).rejects.toThrow(BadRequestException);
      expect(prisma.peerReview.create).not.toHaveBeenCalled();
    });

    it('enforces maxPeers over non-REJECTED rows (cap)', async () => {
      prisma.peerReview.count.mockResolvedValue(3);
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(BadRequestException);
      expect(prisma.peerReview.count).toHaveBeenCalledWith({
        where: { tenantId: T, reviewId: 'rev-1', status: { not: 'REJECTED' } },
      });
      expect(prisma.peerReview.create).not.toHaveBeenCalled();
    });

    it('allows the last slot under the cap', async () => {
      prisma.peerReview.count.mockResolvedValue(2);
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).resolves.toBeDefined();
    });

    it('409s when a row already exists for the peer', async () => {
      prisma.peerReview.findFirst.mockResolvedValue({ id: 'pr-0', status: 'NOMINATED' });
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(ConflictException);
    });

    it('409s when re-nominating a previously REJECTED peer', async () => {
      prisma.peerReview.findFirst.mockResolvedValue({ id: 'pr-0', status: 'REJECTED' });
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(ConflictException);
    });

    it('409s when the create loses a unique race (P2002)', async () => {
      prisma.peerReview.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).rejects.toThrow(ConflictException);
    });

    it('a failing notification never fails the request', async () => {
      notifications.notifyEmployee.mockRejectedValue(new Error('boom'));
      await expect(service.add(self, 'rev-1', { peerEmployeeId: 'emp-peer' })).resolves.toBeDefined();
    });
  });

  // ============================================
  // withdraw
  // ============================================

  describe('withdraw', () => {
    beforeEach(() => {
      prisma.performanceReview.findFirst.mockResolvedValue(review());
      prisma.peerReview.findFirst.mockResolvedValue({ id: 'pr-1', status: 'NOMINATED' });
    });

    it('lets the employee delete a NOMINATED row', async () => {
      await service.withdraw(self, 'rev-1', 'pr-1');
      expect(prisma.peerReview.findFirst).toHaveBeenCalledWith({
        where: { id: 'pr-1', reviewId: 'rev-1', tenantId: T },
      });
      expect(prisma.peerReview.delete).toHaveBeenCalledWith({ where: { id: 'pr-1' } });
    });

    it.each([['reviewer', reviewer], ['admin', admin]])('refuses %s with 403', async (_n, actor) => {
      await expect(service.withdraw(actor, 'rev-1', 'pr-1')).rejects.toThrow(ForbiddenException);
      expect(prisma.peerReview.delete).not.toHaveBeenCalled();
    });

    it('404s for a stranger', async () => {
      await expect(service.withdraw(stranger, 'rev-1', 'pr-1')).rejects.toThrow(NotFoundException);
    });

    it('404s when the row is missing or belongs to another review', async () => {
      prisma.peerReview.findFirst.mockResolvedValue(null);
      await expect(service.withdraw(self, 'rev-1', 'pr-1')).rejects.toThrow(NotFoundException);
    });

    it.each(['APPROVED', 'REJECTED', 'SUBMITTED', 'DECLINED'])('400s for a %s row', async (status) => {
      prisma.peerReview.findFirst.mockResolvedValue({ id: 'pr-1', status });
      await expect(service.withdraw(self, 'rev-1', 'pr-1')).rejects.toThrow(BadRequestException);
      expect(prisma.peerReview.delete).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // decide
  // ============================================

  describe('decide', () => {
    beforeEach(() => {
      prisma.performanceReview.findFirst.mockResolvedValue(review());
      prisma.peerReview.findFirst.mockResolvedValue({ id: 'pr-1', status: 'NOMINATED', peerEmployeeId: 'emp-peer' });
      prisma.peerReview.update.mockImplementation(async ({ data }: any) => ({
        id: 'pr-1', ...data, peer: name('emp-peer'), nominatedBy: name('emp-1'), answers: [],
        submittedAt: null, overallComment: null,
      }));
    });

    it('approve: APPROVED + decided audit fields + notifies the peer', async () => {
      const result: any = await service.decide(reviewer, 'rev-1', 'pr-1', true);

      expect(prisma.peerReview.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pr-1' },
          data: { status: 'APPROVED', decidedAt: expect.any(Date), decidedByUserId: reviewer.userId },
        }),
      );
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        T, 'emp-peer', 'PEER_FEEDBACK_REQUESTED', expect.any(String), expect.any(String),
        '/performance/feedback-requests',
      );
      expect(result.status).toBe('APPROVED');
      expect(result.nominatedBy).toEqual(name('emp-1'));
    });

    it('reject: REJECTED and no peer notification', async () => {
      await service.decide(admin, 'rev-1', 'pr-1', false);
      expect(prisma.peerReview.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
      expect(notifications.notifyEmployee).not.toHaveBeenCalled();
    });

    it('refuses the employee (SELF) with 403', async () => {
      await expect(service.decide(self, 'rev-1', 'pr-1', true)).rejects.toThrow(ForbiddenException);
      expect(prisma.peerReview.update).not.toHaveBeenCalled();
    });

    it('refuses an admin deciding on their own review (admin-as-self is SELF)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ employeeId: 'emp-hr' }));
      await expect(service.decide(admin, 'rev-1', 'pr-1', true)).rejects.toThrow(ForbiddenException);
    });

    it('404s for a stranger and for a missing row', async () => {
      await expect(service.decide(stranger, 'rev-1', 'pr-1', true)).rejects.toThrow(NotFoundException);
      prisma.peerReview.findFirst.mockResolvedValue(null);
      await expect(service.decide(reviewer, 'rev-1', 'pr-1', true)).rejects.toThrow(NotFoundException);
    });

    it.each(['APPROVED', 'REJECTED', 'SUBMITTED', 'DECLINED'])('400s when the row is %s', async (status) => {
      prisma.peerReview.findFirst.mockResolvedValue({ id: 'pr-1', status, peerEmployeeId: 'emp-peer' });
      await expect(service.decide(reviewer, 'rev-1', 'pr-1', true)).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // listForReview
  // ============================================

  describe('listForReview', () => {
    const rows = [
      { id: 'pr-a', status: 'SUBMITTED', peer: name('p1'), nominatedBy: name('emp-1'), submittedAt: new Date('2026-03-15T12:00:00Z'), overallComment: 'great', answers: [{ cycleQuestionId: 'q1', rating: 5, text: null }] },
      { id: 'pr-b', status: 'DECLINED', peer: name('p2'), nominatedBy: null, submittedAt: null, overallComment: null, answers: [] },
      { id: 'pr-c', status: 'APPROVED', peer: name('p3'), nominatedBy: null, submittedAt: null, overallComment: null, answers: [] },
      { id: 'pr-d', status: 'NOMINATED', peer: name('p4'), nominatedBy: name('emp-1'), submittedAt: null, overallComment: null, answers: [] },
      { id: 'pr-e', status: 'REJECTED', peer: name('p5'), nominatedBy: name('emp-1'), submittedAt: null, overallComment: null, answers: [] },
    ];

    it('404s for a stranger', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review());
      await expect(service.listForReview(stranger, 'rev-1')).rejects.toThrow(NotFoundException);
    });

    it.each([['reviewer', reviewer], ['admin', admin]])(
      '%s sees full rows: real status, nominator, answers, comment',
      async (_n, actor) => {
        prisma.performanceReview.findFirst.mockResolvedValue(review());
        prisma.peerReview.findMany.mockResolvedValue(rows);

        const result: any[] = await service.listForReview(actor, 'rev-1');

        expect(result.map((r) => r.status)).toEqual(['SUBMITTED', 'DECLINED', 'APPROVED', 'NOMINATED', 'REJECTED']);
        expect(result[0]).toEqual({
          id: 'pr-a', status: 'SUBMITTED', closed: false, peer: name('p1'), nominatedBy: name('emp-1'),
          submittedAt: new Date('2026-03-15T12:00:00Z'), overallComment: 'great',
          answers: [{ cycleQuestionId: 'q1', audience: 'PEER', rating: 5, text: null }],
        });
      },
    );

    it('SELF gets { id, status, closed, peer } with SUBMITTED and DECLINED shown as APPROVED (Review Focus 3)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review());
      prisma.peerReview.findMany.mockResolvedValue(rows);

      const result: any[] = await service.listForReview(self, 'rev-1');

      expect(result.map((r) => r.status)).toEqual(['APPROVED', 'APPROVED', 'APPROVED', 'NOMINATED', 'REJECTED']);
      for (const r of result) {
        expect(Object.keys(r).sort()).toEqual(['closed', 'id', 'peer', 'status']);
      }
      expect(JSON.stringify(result)).not.toMatch(/great|SUBMITTED|DECLINED/);
    });

    it('SELF never loads answers or comments from the database', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review());
      prisma.peerReview.findMany.mockResolvedValue([]);

      await service.listForReview(self, 'rev-1');

      const args = prisma.peerReview.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ reviewId: 'rev-1', tenantId: T });
      expect(args.include?.answers).toBeUndefined();
      expect(args.select?.answers).toBeUndefined();
      expect(args.select?.overallComment).toBeUndefined();
    });

    it('SELF: after completion, closed cannot tell SUBMITTED from an unanswered APPROVED row', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ status: 'COMPLETED' }));
      prisma.peerReview.findMany.mockResolvedValue(rows);

      const result: any[] = await service.listForReview(self, 'rev-1');

      const masked = result.filter((r) => r.status === 'APPROVED');
      expect(masked).toHaveLength(3);
      expect(new Set(masked.map((r) => r.closed))).toEqual(new Set([true]));
    });

    it('reviewer: closed is true only for unanswered APPROVED rows after completion', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ status: 'COMPLETED' }));
      prisma.peerReview.findMany.mockResolvedValue(rows);

      const result: any[] = await service.listForReview(reviewer, 'rev-1');

      expect(result.filter((r) => r.closed).map((r) => r.id)).toEqual(['pr-c']);
    });

    it('SELF: closed is true once the CYCLE is COMPLETED even if the review is not', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ cycle: cycle({ status: 'COMPLETED' }) }));
      prisma.peerReview.findMany.mockResolvedValue(rows);

      const result: any[] = await service.listForReview(self, 'rev-1');

      const masked = result.filter((r) => r.status === 'APPROVED');
      expect(masked).toHaveLength(3);
      expect(new Set(masked.map((r) => r.closed))).toEqual(new Set([true]));
    });

    it('reviewer: closed is true for unanswered APPROVED rows once the CYCLE is COMPLETED', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ cycle: cycle({ status: 'COMPLETED' }) }));
      prisma.peerReview.findMany.mockResolvedValue(rows);

      const result: any[] = await service.listForReview(reviewer, 'rev-1');

      expect(result.filter((r) => r.closed).map((r) => r.id)).toEqual(['pr-c']);
    });

    it('works for a viewer even when peer feedback is disabled (read-only)', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review({ cycle: cycle({ peerFeedbackEnabled: false }) }));
      prisma.peerReview.findMany.mockResolvedValue([]);
      await expect(service.listForReview(self, 'rev-1')).resolves.toEqual([]);
    });
  });

  // ============================================
  // myRequests / getRequest
  // ============================================

  describe('myRequests / getRequest', () => {
    const request = (over: Record<string, any> = {}) => ({
      id: 'pr-1',
      status: 'APPROVED',
      overallComment: null,
      answers: [],
      review: {
        status: 'SELF_REVIEW',
        cycleId: 'c1',
        employee: name('emp-1'),
        cycle: { id: 'c1', name: 'Q1' },
      },
      ...over,
    });
    const peerQuestion = { id: 'q1', text: 'How was it?', type: 'TEXT', audience: 'PEER', isRequired: true, sortOrder: 0 };
    const dbQuestion = { ...peerQuestion, cycleId: 'c1' };

    it('400s without an employee profile before touching the database', async () => {
      await expect(service.myRequests(noEmployee)).rejects.toThrow(BadRequestException);
      await expect(service.getRequest(noEmployee, 'pr-1')).rejects.toThrow(BadRequestException);
      expect(prisma.peerReview.findMany).not.toHaveBeenCalled();
      expect(prisma.peerReview.findFirst).not.toHaveBeenCalled();
    });

    it('lists only the caller\'s APPROVED/SUBMITTED/DECLINED rows with questions and own answers', async () => {
      prisma.peerReview.findMany.mockResolvedValue([
        request({ answers: [{ cycleQuestionId: 'q1', rating: null, text: 'fine' }], status: 'SUBMITTED', overallComment: 'ok' }),
      ]);
      prisma.reviewCycleQuestion.findMany.mockResolvedValue([dbQuestion]);

      const result: any[] = await service.myRequests(peerUser);

      expect(prisma.peerReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: T, peerEmployeeId: 'emp-peer', status: { in: ['APPROVED', 'SUBMITTED', 'DECLINED'] } },
        }),
      );
      expect(prisma.reviewCycleQuestion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: T, cycleId: { in: ['c1'] }, audience: 'PEER' } }),
      );
      expect(result).toEqual([
        {
          id: 'pr-1',
          status: 'SUBMITTED',
          closed: false,
          reviewee: name('emp-1'),
          cycle: { id: 'c1', name: 'Q1' },
          questions: [peerQuestion],
          answers: [{ cycleQuestionId: 'q1', audience: 'PEER', rating: null, text: 'fine' }],
          overallComment: 'ok',
        },
      ]);
    });

    it('skips the questions query when there are no requests', async () => {
      prisma.peerReview.findMany.mockResolvedValue([]);
      await expect(service.myRequests(peerUser)).resolves.toEqual([]);
      expect(prisma.reviewCycleQuestion.findMany).not.toHaveBeenCalled();
    });

    it('closed = APPROVED and review COMPLETED', async () => {
      prisma.peerReview.findMany.mockResolvedValue([
        request({ review: { ...request().review, status: 'COMPLETED' } }),
        request({ id: 'pr-2', status: 'SUBMITTED', review: { ...request().review, status: 'COMPLETED' } }),
      ]);
      prisma.reviewCycleQuestion.findMany.mockResolvedValue([]);

      const result: any[] = await service.myRequests(peerUser);

      expect(result.map((r) => r.closed)).toEqual([true, false]);
    });

    it('closed is true for an APPROVED request when only the CYCLE is COMPLETED', async () => {
      const cyc = { id: 'c1', name: 'Q1', status: 'COMPLETED' };
      prisma.peerReview.findMany.mockResolvedValue([
        request({ review: { ...request().review, cycle: cyc } }),
        request({ id: 'pr-2', status: 'SUBMITTED', review: { ...request().review, cycle: cyc } }),
      ]);
      prisma.reviewCycleQuestion.findMany.mockResolvedValue([]);

      const result: any[] = await service.myRequests(peerUser);

      expect(result.map((r) => r.closed)).toEqual([true, false]);
    });

    it('getRequest scopes by id, tenant and the caller as peer; 404 for others rows', async () => {
      prisma.peerReview.findFirst.mockResolvedValue(null);
      await expect(service.getRequest(stranger, 'pr-1')).rejects.toThrow(NotFoundException);
      expect(prisma.peerReview.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pr-1', tenantId: T, peerEmployeeId: 'emp-x', status: { in: ['APPROVED', 'SUBMITTED', 'DECLINED'] } },
        }),
      );
    });

    it('getRequest returns the shaped request', async () => {
      prisma.peerReview.findFirst.mockResolvedValue(request());
      prisma.reviewCycleQuestion.findMany.mockResolvedValue([dbQuestion]);
      const result: any = await service.getRequest(peerUser, 'pr-1');
      expect(result.questions).toEqual([peerQuestion]);
      expect(result.reviewee).toEqual(name('emp-1'));
    });
  });

  // ============================================
  // submit / decline
  // ============================================

  describe('submit', () => {
    const openRow = (over: Record<string, any> = {}) => ({
      id: 'pr-1',
      status: 'APPROVED',
      review: { id: 'rev-1', status: 'SELF_REVIEW', cycleId: 'c1', cycle: cycle() },
      ...over,
    });
    const peerQuestions = [
      { id: 'q1', type: 'RATING', audience: 'PEER', isRequired: true },
      { id: 'q2', type: 'TEXT', audience: 'PEER', isRequired: false },
      { id: 'q3', type: 'RATING', audience: 'SELF', isRequired: true },
    ];
    const dto = { answers: [{ cycleQuestionId: 'q1', rating: 4 }], overallComment: '  Solid teammate  ' };

    beforeEach(() => {
      prisma.peerReview.findFirst.mockResolvedValue(openRow());
      prisma.reviewCycleQuestion.findMany.mockResolvedValue(peerQuestions);
      prisma.peerReview.findFirst
        .mockResolvedValueOnce(openRow())
        .mockResolvedValue({ ...openRow(), status: 'SUBMITTED', answers: [], overallComment: 'Solid teammate', review: { status: 'SELF_REVIEW', cycleId: 'c1', employee: name('emp-1'), cycle: { id: 'c1', name: 'Q1' } } });
    });

    it('400s without an employee profile', async () => {
      await expect(service.submit(noEmployee, 'pr-1', dto)).rejects.toThrow(BadRequestException);
      expect(prisma.peerReview.findFirst).not.toHaveBeenCalled();
    });

    it('404s for a row that is not the caller\'s', async () => {
      prisma.peerReview.findFirst.mockReset();
      prisma.peerReview.findFirst.mockResolvedValue(null);
      await expect(service.submit(stranger, 'pr-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('writes answers and flips to SUBMITTED in one transaction', async () => {
      await service.submit(peerUser, 'pr-1', dto);

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.peerReviewAnswer.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: T, peerReviewId: 'pr-1', cycleQuestionId: 'q1', rating: 4, text: null }],
      });
      expect(prisma.peerReview.updateMany).toHaveBeenCalledWith({
        where: { id: 'pr-1', tenantId: T, status: 'APPROVED' },
        data: { status: 'SUBMITTED', submittedAt: expect.any(Date), overallComment: 'Solid teammate' },
      });
    });

    it('validates answers against PEER questions (missing required → 400)', async () => {
      await expect(
        service.submit(peerUser, 'pr-1', { answers: [], overallComment: 'x' }),
      ).rejects.toThrow('Please answer every required question');
      expect(prisma.peerReviewAnswer.createMany).not.toHaveBeenCalled();
    });

    it('rejects an answer to a non-PEER question', async () => {
      await expect(
        service.submit(peerUser, 'pr-1', { answers: [{ cycleQuestionId: 'q3', rating: 3 }, { cycleQuestionId: 'q1', rating: 3 }], overallComment: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it.each(['', '   ', 'a'.repeat(5001)])('rejects overallComment %#', async (overallComment) => {
      await expect(service.submit(peerUser, 'pr-1', { answers: dto.answers, overallComment })).rejects.toThrow(
        BadRequestException,
      );
    });

    it.each(['SUBMITTED', 'DECLINED'])('400s when the row is already %s', async (status) => {
      prisma.peerReview.findFirst.mockReset();
      prisma.peerReview.findFirst.mockResolvedValue(openRow({ status }));
      await expect(service.submit(peerUser, 'pr-1', dto)).rejects.toThrow(BadRequestException);
      expect(prisma.peerReviewAnswer.createMany).not.toHaveBeenCalled();
    });

    it('400s once the review is COMPLETED (closed after manager submit)', async () => {
      prisma.peerReview.findFirst.mockReset();
      prisma.peerReview.findFirst.mockResolvedValue(openRow({ review: { id: 'rev-1', status: 'COMPLETED', cycleId: 'c1', cycle: cycle() } }));
      await expect(service.submit(peerUser, 'pr-1', dto)).rejects.toThrow('Peer feedback is closed');
      expect(prisma.peerReviewAnswer.createMany).not.toHaveBeenCalled();
    });

    it('400s once the cycle is COMPLETED (Review Focus 4)', async () => {
      prisma.peerReview.findFirst.mockReset();
      prisma.peerReview.findFirst.mockResolvedValue(openRow({ review: { id: 'rev-1', status: 'SELF_REVIEW', cycleId: 'c1', cycle: cycle({ status: 'COMPLETED' }) } }));
      await expect(service.submit(peerUser, 'pr-1', dto)).rejects.toThrow(BadRequestException);
    });

    it('409s when a concurrent response already moved the row', async () => {
      prisma.peerReview.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.submit(peerUser, 'pr-1', dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('decline', () => {
    const openRow = (over: Record<string, any> = {}) => ({
      id: 'pr-1',
      status: 'APPROVED',
      review: { id: 'rev-1', status: 'SELF_REVIEW', cycleId: 'c1', cycle: cycle() },
      ...over,
    });

    beforeEach(() => {
      prisma.reviewCycleQuestion.findMany.mockResolvedValue([]);
    });

    it('400s without an employee profile', async () => {
      await expect(service.decline(noEmployee, 'pr-1')).rejects.toThrow(BadRequestException);
    });

    it('moves APPROVED to DECLINED', async () => {
      prisma.peerReview.findFirst.mockResolvedValue({ ...openRow(), answers: [], overallComment: null, review: { ...openRow().review, employee: name('emp-1') } });
      await service.decline(peerUser, 'pr-1');
      expect(prisma.peerReview.updateMany).toHaveBeenCalledWith({
        where: { id: 'pr-1', tenantId: T, status: 'APPROVED' },
        data: { status: 'DECLINED' },
      });
    });

    it('400s when not APPROVED', async () => {
      prisma.peerReview.findFirst.mockResolvedValue(openRow({ status: 'SUBMITTED' }));
      await expect(service.decline(peerUser, 'pr-1')).rejects.toThrow(BadRequestException);
      expect(prisma.peerReview.updateMany).not.toHaveBeenCalled();
    });

    it('400s once the review is COMPLETED', async () => {
      prisma.peerReview.findFirst.mockResolvedValue(openRow({ review: { id: 'rev-1', status: 'COMPLETED', cycleId: 'c1', cycle: cycle() } }));
      await expect(service.decline(peerUser, 'pr-1')).rejects.toThrow('Peer feedback is closed');
    });

    it('409s on a lost race', async () => {
      prisma.peerReview.findFirst.mockResolvedValue(openRow());
      prisma.peerReview.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.decline(peerUser, 'pr-1')).rejects.toThrow(ConflictException);
    });
  });

  // ============================================
  // anonymousFeedback
  // ============================================

  describe('anonymousFeedback', () => {
    const submitted = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `pr-${i}`,
        peerEmployeeId: `peer-${i}`,
        submittedAt: new Date('2026-03-15T12:00:00Z'),
        overallComment: `comment-${i}`,
        peer: name(`peer-${i}`),
        answers: [
          { id: `a-${i}-1`, cycleQuestionId: 'q1', rating: i + 1, text: null, cycleQuestion: { id: 'q1', text: 'Teamwork', type: 'RATING', sortOrder: 2 } },
          { id: `a-${i}-2`, cycleQuestionId: 'q2', rating: null, text: `text-${i}`, cycleQuestion: { id: 'q2', text: 'Strengths', type: 'TEXT', sortOrder: 1 } },
        ],
      }));

    it('not released → NOT_RELEASED and no database read', async () => {
      const result = await service.anonymousFeedback('rev-1', false);
      expect(result).toEqual({ peerFeedback: null, peerFeedbackHiddenReason: 'NOT_RELEASED' });
      expect(prisma.peerReview.findMany).not.toHaveBeenCalled();
    });

    it(`released with ${MIN_ANONYMOUS_PEER_RESPONSES - 1} submissions → TOO_FEW_RESPONSES (Review Focus 3)`, async () => {
      prisma.peerReview.findMany.mockResolvedValue(submitted(MIN_ANONYMOUS_PEER_RESPONSES - 1));
      const result = await service.anonymousFeedback('rev-1', true);
      expect(result).toEqual({ peerFeedback: null, peerFeedbackHiddenReason: 'TOO_FEW_RESPONSES' });
    });

    it('released with zero submissions → TOO_FEW_RESPONSES', async () => {
      prisma.peerReview.findMany.mockResolvedValue([]);
      const result = await service.anonymousFeedback('rev-1', true);
      expect(result.peerFeedbackHiddenReason).toBe('TOO_FEW_RESPONSES');
    });

    it('queries only SUBMITTED rows of the review', async () => {
      prisma.peerReview.findMany.mockResolvedValue([]);
      await service.anonymousFeedback('rev-1', true);
      expect(prisma.peerReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { reviewId: 'rev-1', status: 'SUBMITTED' } }),
      );
    });

    it('threshold met → grouped by question in sortOrder with counts', async () => {
      prisma.peerReview.findMany.mockResolvedValue(submitted(3));
      const result: any = await service.anonymousFeedback('rev-1', true);

      expect(result.peerFeedbackHiddenReason).toBeUndefined();
      const fb = result.peerFeedback;
      expect(fb.submittedCount).toBe(3);
      expect(fb.questions.map((q: any) => q.text)).toEqual(['Strengths', 'Teamwork']);
      expect(fb.questions[0]).toEqual({ text: 'Strengths', type: 'TEXT', ratings: [], texts: expect.any(Array) });
      expect([...fb.questions[0].texts].sort()).toEqual(['text-0', 'text-1', 'text-2']);
      expect([...fb.questions[1].ratings].sort()).toEqual([1, 2, 3]);
      expect([...fb.comments].sort()).toEqual(['comment-0', 'comment-1', 'comment-2']);
    });

    it('output carries no id/peer/name/timestamp keys at any depth', async () => {
      prisma.peerReview.findMany.mockResolvedValue(submitted(4));
      const result = await service.anonymousFeedback('rev-1', true);
      const keys = allKeys(result);
      for (const forbidden of [
        'id', 'peer', 'peerEmployeeId', 'firstName', 'lastName', 'submittedAt', 'createdAt', 'cycleQuestionId', 'nominatedBy',
      ]) {
        expect(keys.has(forbidden)).toBe(false);
      }
      expect(JSON.stringify(result)).not.toMatch(/peer-\d|2026-03/);
    });

    it('skips blank comments and shuffles with Fisher-Yates (permutation preserved)', async () => {
      const rows = submitted(5);
      rows[0].overallComment = null as any;
      prisma.peerReview.findMany.mockResolvedValue(rows);
      // Force a non-identity shuffle: always pick index 0.
      const spy = jest.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const result: any = await service.anonymousFeedback('rev-1', true);
        expect(result.peerFeedback.comments).toHaveLength(4);
        expect([...result.peerFeedback.comments].sort()).toEqual(['comment-1', 'comment-2', 'comment-3', 'comment-4']);
        // the original order was comment-1..4; with random()=0 Fisher-Yates rotates it
        expect(result.peerFeedback.comments).not.toEqual(['comment-1', 'comment-2', 'comment-3', 'comment-4']);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
