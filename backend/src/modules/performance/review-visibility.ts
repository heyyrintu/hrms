import { UserRole } from '@prisma/client';

/**
 * Review visibility mapper (Keka wave F, spec F4). Types frozen by the
 * scaffold; WS2 implements the functions.
 */

export type ViewerRelation = 'SELF' | 'REVIEWER' | 'ADMIN';

export interface ReviewViewer {
  employeeId?: string;
  role: UserRole;
}

/** SELF beats REVIEWER beats ADMIN; null = no access (caller throws 404). */
export function resolveRelation(
  review: { employeeId: string; reviewerId: string },
  viewer: ReviewViewer,
): ViewerRelation | null {
  void review;
  void viewer;
  throw new Error('not implemented');
}

/** `review` must include cycle {status}. Omits (deletes) fields per the spec F4 table. */
export function toReviewView<T extends Record<string, any>>(
  review: T,
  relation: ViewerRelation,
): Record<string, unknown> {
  void review;
  void relation;
  throw new Error('not implemented');
}
