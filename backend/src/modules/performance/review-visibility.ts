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

/** Never shown to the reviewed employee, before or after release. */
const NEVER_TO_SELF = [
  'managerRating',
  'overallRating',
  'calibratedRating',
  'calibrationReason',
  'calibratedById',
  'calibratedAt',
  'potentialRating',
];

/** Shown to the reviewed employee only once the cycle is COMPLETED. */
const HIDDEN_FROM_SELF_UNTIL_RELEASE = [
  'managerComments',
  'managerSubmittedAt',
  'competencyRatings',
];

/** `review` must include cycle {status}. Omits (deletes) fields per the spec F4 table. */
export function toReviewView<T extends Record<string, any>>(
  review: T,
  relation: ViewerRelation,
): Record<string, unknown> {
  const released = review.cycle?.status === 'COMPLETED';
  const view: Record<string, unknown> = {
    ...review,
    relation,
    released,
    finalRating: finalRatingOf(review as any),
  };

  if (relation === 'SELF') {
    for (const k of NEVER_TO_SELF) delete view[k];
    view.answers = ((review.answers ?? []) as Array<{ audience: string }>).filter(
      (a) => released || a.audience === 'SELF',
    );
    if (!released) {
      for (const k of HIDDEN_FROM_SELF_UNTIL_RELEASE) delete view[k];
      delete view.finalRating;
    }
  }

  // Peer data is added by the caller, shaped per relation.
  delete view.peerReviews;
  return view;
}
