import { UserRole } from '@prisma/client';
import { finalRatingOf, isAdminRole } from './performance-rating';

/**
 * Review visibility mapper (Keka wave F, spec F4). Every review response is
 * shaped through `toReviewView`, so the SELF omissions live in one place.
 */

export type ViewerRelation = 'SELF' | 'REVIEWER' | 'ADMIN';

export interface ReviewViewer {
  employeeId?: string;
  role: UserRole;
}

/**
 * SELF beats REVIEWER beats ADMIN; null = no access (caller throws 404).
 * An undefined viewer id never matches, so a user without an employee record
 * can only ever be ADMIN or null.
 */
export function resolveRelation(
  review: { employeeId: string; reviewerId: string },
  viewer: ReviewViewer,
): ViewerRelation | null {
  if (viewer.employeeId && viewer.employeeId === review.employeeId) return 'SELF';
  if (viewer.employeeId && viewer.employeeId === review.reviewerId) return 'REVIEWER';
  if (isAdminRole(viewer.role)) return 'ADMIN';
  return null;
}

/**
 * SELF is built from an explicit allow-list, never by deleting fields from a
 * full row, so a column added to the model later stays hidden until it is
 * listed here. Never listed: updatedAt, tenantId, managerRating,
 * overallRating, potentialRating, calibratedRating, calibrationReason,
 * calibratedById, calibratedAt.
 */
const SELF_ALLOWED = [
  'id',
  'cycleId',
  'employeeId',
  'reviewerId',
  'status',
  'selfRating',
  'selfComments',
  'selfSubmittedAt',
  'createdAt',
  'cycle',
  'employee',
  'reviewer',
  'goals',
];

/** Added to the SELF view only once the cycle is COMPLETED. */
const SELF_ALLOWED_AFTER_RELEASE = ['managerComments', 'managerSubmittedAt', 'competencyRatings'];

function pick(source: Record<string, any>, keys: string[], into: Record<string, unknown>) {
  for (const k of keys) if (k in source) into[k] = source[k];
}

/** `review` must include cycle {status}. SELF is an allow-list; REVIEWER and ADMIN get the full row. */
export function toReviewView<T extends Record<string, any>>(
  review: T,
  relation: ViewerRelation,
): Record<string, unknown> {
  const released = review.cycle?.status === 'COMPLETED';
  const finalRating = finalRatingOf(review as any);

  if (relation === 'SELF') {
    const view: Record<string, unknown> = {};
    pick(review, SELF_ALLOWED, view);
    view.answers = ((review.answers ?? []) as Array<{ audience: string }>).filter(
      (a) => released || a.audience === 'SELF',
    );
    view.relation = relation;
    view.released = released;
    if (released) {
      pick(review, SELF_ALLOWED_AFTER_RELEASE, view);
      view.finalRating = finalRating;
    }
    // Peer feedback is added by the caller.
    return view;
  }

  const view: Record<string, unknown> = { ...review, relation, released, finalRating };
  // Peer data is added by the caller, shaped per relation.
  delete view.peerReviews;
  return view;
}
