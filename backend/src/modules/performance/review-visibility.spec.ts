import { UserRole } from '@prisma/client';
import { resolveRelation, toReviewView } from './review-visibility';

const review = (over: Record<string, any> = {}) => ({
  id: 'rev-1',
  employeeId: 'emp-1',
  reviewerId: 'emp-mgr',
  status: 'COMPLETED',
  selfRating: 3,
  selfComments: 'ok',
  selfSubmittedAt: new Date('2026-03-15T12:00:00Z'),
  managerRating: 4,
  managerComments: 'good',
  managerSubmittedAt: new Date('2026-03-16T12:00:00Z'),
  overallRating: 4,
  calibratedRating: 5,
  calibrationReason: 'Strong year across the board',
  calibratedById: 'user-hr',
  calibratedAt: new Date('2026-03-17T12:00:00Z'),
  potentialRating: 2,
  cycle: { id: 'c1', status: 'ACTIVE' },
  goals: [{ id: 'g1' }],
  competencyRatings: [{ id: 'cr1', managerRating: 4 }],
  answers: [
    { cycleQuestionId: 'q1', audience: 'SELF', rating: 3, text: null },
    { cycleQuestionId: 'q2', audience: 'MANAGER', rating: 4, text: null },
  ],
  peerReviews: [{ id: 'p1' }],
  ...over,
});

const released = (over: Record<string, any> = {}) =>
  review({ cycle: { id: 'c1', status: 'COMPLETED' }, ...over });

describe('resolveRelation', () => {
  const r = { employeeId: 'emp-1', reviewerId: 'emp-mgr' };

  it('is SELF for the reviewed employee', () => {
    expect(resolveRelation(r, { employeeId: 'emp-1', role: UserRole.EMPLOYEE })).toBe('SELF');
  });

  it('is REVIEWER for the assigned reviewer', () => {
    expect(resolveRelation(r, { employeeId: 'emp-mgr', role: UserRole.MANAGER })).toBe('REVIEWER');
  });

  it('is ADMIN for HR_ADMIN and SUPER_ADMIN who are neither', () => {
    expect(resolveRelation(r, { employeeId: 'x', role: UserRole.HR_ADMIN })).toBe('ADMIN');
    expect(resolveRelation(r, { employeeId: undefined, role: UserRole.SUPER_ADMIN })).toBe('ADMIN');
  });

  it('admin viewing their own review is SELF, not ADMIN (Review Focus 2)', () => {
    expect(resolveRelation(r, { employeeId: 'emp-1', role: UserRole.HR_ADMIN })).toBe('SELF');
    expect(resolveRelation(r, { employeeId: 'emp-1', role: UserRole.SUPER_ADMIN })).toBe('SELF');
  });

  it('admin who is the reviewer is REVIEWER', () => {
    expect(resolveRelation(r, { employeeId: 'emp-mgr', role: UserRole.HR_ADMIN })).toBe('REVIEWER');
  });

  it('returns null for a stranger', () => {
    expect(resolveRelation(r, { employeeId: 'stranger', role: UserRole.EMPLOYEE })).toBeNull();
    expect(resolveRelation(r, { employeeId: 'stranger', role: UserRole.MANAGER })).toBeNull();
  });

  it('an undefined viewer employeeId never matches', () => {
    expect(resolveRelation(r, { employeeId: undefined, role: UserRole.EMPLOYEE })).toBeNull();
    expect(
      resolveRelation({ employeeId: 'emp-1', reviewerId: undefined as any }, { employeeId: undefined, role: UserRole.MANAGER }),
    ).toBeNull();
  });
});

describe('toReviewView', () => {
  describe('SELF before release', () => {
    const view = toReviewView(review(), 'SELF') as any;

    it('omits (not nulls) every never-to-self field', () => {
      for (const k of [
        'managerRating', 'overallRating', 'calibratedRating', 'calibrationReason',
        'calibratedById', 'calibratedAt', 'potentialRating',
      ]) {
        expect(k in view).toBe(false);
      }
    });

    it('omits manager comments, competency ratings and finalRating', () => {
      for (const k of ['managerComments', 'managerSubmittedAt', 'competencyRatings', 'finalRating']) {
        expect(k in view).toBe(false);
      }
    });

    it('keeps self fields and goals, only SELF answers', () => {
      expect(view.selfRating).toBe(3);
      expect(view.selfComments).toBe('ok');
      expect(view.goals).toEqual([{ id: 'g1' }]);
      expect(view.answers).toEqual([
        { cycleQuestionId: 'q1', audience: 'SELF', rating: 3, text: null },
      ]);
    });

    it('sets relation and released=false and strips peerReviews', () => {
      expect(view.relation).toBe('SELF');
      expect(view.released).toBe(false);
      expect('peerReviews' in view).toBe(false);
    });
  });

  describe('SELF allow-list', () => {
    const extra = { updatedAt: new Date(), tenantId: 't1', someFutureColumn: 'secret' };

    it('drops updatedAt, tenantId and any unknown field, before and after release', () => {
      for (const r of [review(extra), released(extra)]) {
        const view = toReviewView(r, 'SELF') as any;
        for (const k of ['updatedAt', 'tenantId', 'someFutureColumn']) expect(k in view).toBe(false);
      }
    });

    it('keeps exactly the allow-listed keys before release', () => {
      const view = toReviewView(review(extra), 'SELF') as any;
      expect(Object.keys(view).sort()).toEqual(
        ['answers', 'cycle', 'goals', 'relation', 'released', 'selfComments', 'selfRating', 'selfSubmittedAt', 'id', 'employeeId', 'reviewerId', 'status'].sort(),
      );
    });

    it('adds the release-gated keys after release', () => {
      const view = toReviewView(released(extra), 'SELF') as any;
      for (const k of ['managerComments', 'managerSubmittedAt', 'competencyRatings', 'finalRating']) {
        expect(k in view).toBe(true);
      }
    });

    it('REVIEWER and ADMIN views are unchanged: they keep unknown fields and updatedAt', () => {
      for (const rel of ['REVIEWER', 'ADMIN'] as const) {
        const view = toReviewView(review(extra), rel) as any;
        expect(view.updatedAt).toBe(extra.updatedAt);
        expect(view.someFutureColumn).toBe('secret');
        expect(view.managerRating).toBe(4);
      }
    });
  });

  describe('SELF after release', () => {
    const view = toReviewView(released(), 'SELF') as any;

    it('shows finalRating (calibrated wins), manager comments, competencies, all answers', () => {
      expect(view.released).toBe(true);
      expect(view.finalRating).toBe(5);
      expect(view.managerComments).toBe('good');
      expect(view.competencyRatings).toEqual([{ id: 'cr1', managerRating: 4 }]);
      expect(view.answers).toHaveLength(2);
    });

    it('still never shows rating breakdown, calibration or potential', () => {
      for (const k of [
        'managerRating', 'overallRating', 'calibratedRating', 'calibrationReason',
        'calibratedById', 'calibratedAt', 'potentialRating',
      ]) {
        expect(k in view).toBe(false);
      }
    });

    it('finalRating falls back to overallRating without calibration', () => {
      const v = toReviewView(released({ calibratedRating: null }), 'SELF') as any;
      expect(v.finalRating).toBe(4);
    });
  });

  describe.each(['REVIEWER', 'ADMIN'] as const)('%s', (relation) => {
    it('sees everything before release, including potential and calibration', () => {
      const view = toReviewView(review(), relation) as any;
      expect(view.relation).toBe(relation);
      expect(view.released).toBe(false);
      expect(view.managerRating).toBe(4);
      expect(view.overallRating).toBe(4);
      expect(view.calibratedRating).toBe(5);
      expect(view.calibrationReason).toBe('Strong year across the board');
      expect(view.potentialRating).toBe(2);
      expect(view.managerComments).toBe('good');
      expect(view.finalRating).toBe(5);
      expect(view.answers).toHaveLength(2);
      expect(view.competencyRatings).toHaveLength(1);
      expect('peerReviews' in view).toBe(false);
    });

    it('sees the same after release', () => {
      const view = toReviewView(released(), relation) as any;
      expect(view.released).toBe(true);
      expect(view.potentialRating).toBe(2);
    });
  });

  it('treats a missing cycle as not released', () => {
    const view = toReviewView(review({ cycle: undefined }), 'SELF') as any;
    expect(view.released).toBe(false);
    expect('finalRating' in view).toBe(false);
  });

  it('does not mutate the input review', () => {
    const input = review();
    toReviewView(input, 'SELF');
    expect(input.managerRating).toBe(4);
    expect(input.answers).toHaveLength(2);
    expect(input.peerReviews).toHaveLength(1);
  });

  it('tolerates a review without answers', () => {
    const view = toReviewView(review({ answers: undefined }), 'SELF') as any;
    expect(view.answers).toEqual([]);
  });
});
