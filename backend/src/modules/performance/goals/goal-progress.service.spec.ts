import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GoalProgressService, computeKrProgress } from './goal-progress.service';
import { FeedService } from '../../engagement/feed/feed.service';
import { FEED_SOURCE } from '../../engagement/feed/feed.types';
import { createMockPrismaService } from '../../../test/helpers';

describe('computeKrProgress', () => {
  const base = { metricType: 'NUMBER' as const, startValue: 0, targetValue: 100 };

  it('computes an increasing metric (0 -> 50 at 25 = 50)', () => {
    expect(computeKrProgress({ ...base, targetValue: 50, currentValue: 25 })).toBe(50);
  });
  it('computes a decreasing metric (100 -> 20 at 60 = 50)', () => {
    expect(computeKrProgress({ ...base, startValue: 100, targetValue: 20, currentValue: 60 })).toBe(50);
  });
  it('clamps overshoot to 100', () => {
    expect(computeKrProgress({ ...base, currentValue: 250 })).toBe(100);
  });
  it('clamps below-start to 0', () => {
    expect(computeKrProgress({ ...base, startValue: 10, currentValue: -5 })).toBe(0);
  });
  it('treats BOOLEAN as 100 at >= 1 and 0 below', () => {
    expect(computeKrProgress({ ...base, metricType: 'BOOLEAN', currentValue: 1 })).toBe(100);
    expect(computeKrProgress({ ...base, metricType: 'BOOLEAN', currentValue: 0 })).toBe(0);
  });
  it('rejects start == target with 400', () => {
    expect(() => computeKrProgress({ ...base, startValue: 5, targetValue: 5, currentValue: 5 })).toThrow(
      BadRequestException,
    );
  });
});

describe('GoalProgressService', () => {
  let service: GoalProgressService;
  let feed: { post: jest.Mock };
  let tx: any;

  /** A goal row as recomputeChain loads it. */
  const goal = (over: Record<string, unknown> = {}) => ({
    id: 'g',
    tenantId: 't1',
    title: 'Goal',
    ownerType: 'COMPANY',
    employeeId: null,
    shareOnFeed: false,
    status: 'NOT_STARTED',
    progress: 0,
    weight: 1,
    completedAt: null,
    parentGoalId: null,
    keyResults: [],
    children: [],
    department: null,
    ...over,
  });
  const kr = (progress: number, weight: any = 1) => ({ progress, weight });

  beforeEach(async () => {
    feed = { post: jest.fn().mockResolvedValue({ id: 'f1', created: true }) };
    const module = await Test.createTestingModule({
      providers: [GoalProgressService, { provide: FeedService, useValue: feed }],
    }).compile();
    service = module.get(GoalProgressService);
    tx = createMockPrismaService();
    tx.goal.update.mockResolvedValue({});
  });

  describe('derive', () => {
    it('lets key results win over children', () => {
      expect(
        service.derive(goal({ keyResults: [kr(40)], children: [{ progress: 100, weight: 1 }] })),
      ).toEqual({ progress: 40 });
    });
    it('weights key results by weight and rounds', () => {
      // (100*1 + 0*2) / 3 = 33.33
      expect(service.derive(goal({ keyResults: [kr(100, 1), kr(0, 2)] }))).toEqual({ progress: 33 });
    });
    it('weights children by weight when there are no key results', () => {
      expect(
        service.derive(goal({ children: [{ progress: 100, weight: 3 }, { progress: 0, weight: 1 }] })),
      ).toEqual({ progress: 75 });
    });
    it('reads Prisma Decimal weights through Number()', () => {
      const dec = (n: number) => ({ toString: () => String(n), valueOf: () => n }) as any;
      expect(
        service.derive(goal({ keyResults: [kr(100, dec(1)), kr(0, dec(1))] })),
      ).toEqual({ progress: 50 });
    });
    it('returns null for a manual goal', () => {
      expect(service.derive(goal())).toBeNull();
    });
  });

  describe('recomputeChain', () => {
    it('stops silently when the goal is not found (tenant scoped)', async () => {
      tx.goal.findFirst.mockResolvedValue(null);
      await service.recomputeChain('t1', 'missing', tx);
      expect(tx.goal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'missing', tenantId: 't1' } }),
      );
      expect(tx.goal.update).not.toHaveBeenCalled();
    });

    it('leaves a manual goal alone but still recomputes its parent', async () => {
      tx.goal.findFirst
        .mockResolvedValueOnce(goal({ id: 'child', parentGoalId: 'parent', progress: 20 }))
        .mockResolvedValueOnce(goal({ id: 'parent', children: [{ progress: 20, weight: 1 }] }));
      await service.recomputeChain('t1', 'child', tx);
      expect(tx.goal.update).toHaveBeenCalledTimes(1);
      expect(tx.goal.update).toHaveBeenCalledWith({
        where: { id: 'parent' },
        data: { progress: 20, status: 'IN_PROGRESS', completedAt: null },
      });
    });

    it('derives status NOT_STARTED / COMPLETED and stamps completedAt', async () => {
      tx.goal.findFirst.mockResolvedValueOnce(goal({ keyResults: [kr(0)] }));
      await service.recomputeChain('t1', 'g', tx);
      expect(tx.goal.update).toHaveBeenLastCalledWith({
        where: { id: 'g' },
        data: { progress: 0, status: 'NOT_STARTED', completedAt: null },
      });

      tx.goal.findFirst.mockResolvedValueOnce(goal({ keyResults: [kr(100)] }));
      await service.recomputeChain('t1', 'g', tx);
      const data = tx.goal.update.mock.calls[1][0].data;
      expect(data).toMatchObject({ progress: 100, status: 'COMPLETED' });
      expect(data.completedAt).toBeInstanceOf(Date);
    });

    it('keeps an existing completedAt and clears it when the goal reopens', async () => {
      const done = new Date('2026-03-15T12:00:00Z');
      tx.goal.findFirst.mockResolvedValueOnce(
        goal({ status: 'COMPLETED', completedAt: done, keyResults: [kr(100)] }),
      );
      await service.recomputeChain('t1', 'g', tx);
      expect(tx.goal.update.mock.calls[0][0].data.completedAt).toBe(done);

      tx.goal.findFirst.mockResolvedValueOnce(
        goal({ status: 'COMPLETED', completedAt: done, keyResults: [kr(50)] }),
      );
      await service.recomputeChain('t1', 'g', tx);
      expect(tx.goal.update.mock.calls[1][0].data).toEqual({
        progress: 50,
        status: 'IN_PROGRESS',
        completedAt: null,
      });
    });

    it('posts exactly one feed item, with tx, for a newly completed company goal', async () => {
      tx.goal.findFirst.mockResolvedValueOnce(
        goal({ id: 'g1', title: 'Ship v2', keyResults: [kr(100)], department: { name: 'Eng' } }),
      );
      await service.recomputeChain('t1', 'g1', tx);
      expect(feed.post).toHaveBeenCalledTimes(1);
      expect(feed.post).toHaveBeenCalledWith(
        {
          tenantId: 't1',
          type: 'GOAL_COMPLETED',
          sourceType: FEED_SOURCE.GOAL,
          sourceId: 'g1',
          subjectEmployeeId: null,
          actorEmployeeId: null,
          title: 'Ship v2',
          payload: { ownerType: 'COMPANY', departmentName: 'Eng' },
          dedupeKey: 'goal-completed:g1',
        },
        tx,
      );
    });

    it('does not post for an unshared employee goal, and posts for a shared one', async () => {
      tx.goal.findFirst.mockResolvedValueOnce(
        goal({ ownerType: 'EMPLOYEE', employeeId: 'e1', keyResults: [kr(100)], shareOnFeed: false }),
      );
      await service.recomputeChain('t1', 'g', tx);
      expect(feed.post).not.toHaveBeenCalled();

      tx.goal.findFirst.mockResolvedValueOnce(
        goal({ ownerType: 'EMPLOYEE', employeeId: 'e1', keyResults: [kr(100)], shareOnFeed: true }),
      );
      await service.recomputeChain('t1', 'g', tx);
      expect(feed.post).toHaveBeenCalledTimes(1);
      expect(feed.post.mock.calls[0][0]).toMatchObject({ subjectEmployeeId: 'e1' });
    });

    it('does not post again for an already-completed goal', async () => {
      tx.goal.findFirst.mockResolvedValueOnce(
        goal({ status: 'COMPLETED', completedAt: new Date(), keyResults: [kr(100)] }),
      );
      await service.recomputeChain('t1', 'g', tx);
      expect(feed.post).not.toHaveBeenCalled();
    });

    // Review Focus 1
    it('a child completed via its KRs completes an all-children parent: one post per newly completed goal', async () => {
      tx.goal.findFirst
        .mockResolvedValueOnce(
          goal({ id: 'child', title: 'Child', parentGoalId: 'parent', keyResults: [kr(100)] }),
        )
        // the parent's only child is now at 100 in the DB
        .mockResolvedValueOnce(
          goal({ id: 'parent', title: 'Parent', children: [{ progress: 100, weight: 1 }] }),
        );
      await service.recomputeChain('t1', 'child', tx);
      expect(feed.post).toHaveBeenCalledTimes(2);
      expect(feed.post.mock.calls.map((c: any[]) => c[0].sourceId)).toEqual(['child', 'parent']);
      expect(feed.post.mock.calls.map((c: any[]) => c[0].dedupeKey)).toEqual([
        'goal-completed:child',
        'goal-completed:parent',
      ]);
      expect(feed.post.mock.calls.every((c: any[]) => c[1] === tx)).toBe(true);
    });

    // Review Focus 1
    it('recomputes a chain of three, then stops at the root', async () => {
      tx.goal.findFirst
        .mockResolvedValueOnce(goal({ id: 'a', parentGoalId: 'b', keyResults: [kr(50)] }))
        .mockResolvedValueOnce(goal({ id: 'b', parentGoalId: 'c', children: [{ progress: 50, weight: 1 }] }))
        .mockResolvedValueOnce(goal({ id: 'c', children: [{ progress: 50, weight: 1 }] }));
      await service.recomputeChain('t1', 'a', tx);
      expect(tx.goal.update.mock.calls.map((c: any[]) => c[0].where.id)).toEqual(['a', 'b', 'c']);
      expect(tx.goal.findFirst).toHaveBeenCalledTimes(3);
    });

    it('caps the walk at 20 hops so a corrupt cycle cannot loop forever', async () => {
      tx.goal.findFirst.mockImplementation(async () =>
        goal({ id: 'loop', parentGoalId: 'loop', children: [{ progress: 10, weight: 1 }] }),
      );
      await service.recomputeChain('t1', 'loop', tx);
      expect(tx.goal.findFirst.mock.calls.length).toBeLessThanOrEqual(21);
    });
  });

  describe('postCompletion', () => {
    it('skips an unshared EMPLOYEE goal', async () => {
      await service.postCompletion(goal({ ownerType: 'EMPLOYEE', shareOnFeed: false }) as any, tx);
      expect(feed.post).not.toHaveBeenCalled();
    });
    it('posts a DEPARTMENT goal with its department name', async () => {
      await service.postCompletion(
        goal({ ownerType: 'DEPARTMENT', department: { name: 'Sales' } }) as any,
        tx,
      );
      expect(feed.post.mock.calls[0][0].payload).toEqual({ ownerType: 'DEPARTMENT', departmentName: 'Sales' });
    });
  });
});
