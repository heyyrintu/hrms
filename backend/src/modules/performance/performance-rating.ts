import { UserRole } from '@prisma/client';

/**
 * Shared rating helpers (Keka wave F). Frozen after the scaffold.
 * Ratings are integers 1-5; potential is an integer 1-3.
 */

/** The employee sees anonymous peer answers only with at least this many submissions. */
export const MIN_ANONYMOUS_PEER_RESPONSES = 3;

export type Band = 'LOW' | 'MEDIUM' | 'HIGH';

/** HR_ADMIN or SUPER_ADMIN. */
export function isAdminRole(role: UserRole): boolean {
  return role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
}

/** finalRating = calibratedRating ?? overallRating (computed, never stored). */
export function finalRatingOf(r: {
  calibratedRating: number | null;
  overallRating: number | null;
}): number | null {
  return r.calibratedRating ?? r.overallRating ?? null;
}

/** 1-2 LOW, 3 MEDIUM, 4-5 HIGH. */
export function performanceBand(finalRating: number): Band {
  if (finalRating <= 2) return 'LOW';
  if (finalRating === 3) return 'MEDIUM';
  return 'HIGH';
}

/** 1 LOW, 2 MEDIUM, 3 HIGH. */
export function potentialBand(potential: number): Band {
  if (potential <= 1) return 'LOW';
  if (potential === 2) return 'MEDIUM';
  return 'HIGH';
}
