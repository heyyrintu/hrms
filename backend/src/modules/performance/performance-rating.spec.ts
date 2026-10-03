import { UserRole } from '@prisma/client';
import {
  MIN_ANONYMOUS_PEER_RESPONSES,
  finalRatingOf,
  isAdminRole,
  performanceBand,
  potentialBand,
} from './performance-rating';

describe('performance-rating', () => {
  it('requires at least 3 peer submissions for the anonymous block', () => {
    expect(MIN_ANONYMOUS_PEER_RESPONSES).toBe(3);
  });

  describe('isAdminRole', () => {
    it.each([
      [UserRole.SUPER_ADMIN, true],
      [UserRole.HR_ADMIN, true],
      [UserRole.MANAGER, false],
      [UserRole.EMPLOYEE, false],
    ])('%s -> %s', (role, expected) => {
      expect(isAdminRole(role)).toBe(expected);
    });
  });

  describe('finalRatingOf', () => {
    it('prefers the calibrated rating', () => {
      expect(finalRatingOf({ calibratedRating: 2, overallRating: 4 })).toBe(2);
    });

    it('falls back to the overall rating', () => {
      expect(finalRatingOf({ calibratedRating: null, overallRating: 4 })).toBe(4);
    });

    it('returns null when both are null', () => {
      expect(finalRatingOf({ calibratedRating: null, overallRating: null })).toBeNull();
    });
  });

  describe('performanceBand', () => {
    it.each([
      [1, 'LOW'],
      [2, 'LOW'],
      [3, 'MEDIUM'],
      [4, 'HIGH'],
      [5, 'HIGH'],
    ])('%i -> %s', (rating, band) => {
      expect(performanceBand(rating)).toBe(band);
    });
  });

  describe('potentialBand', () => {
    it.each([
      [1, 'LOW'],
      [2, 'MEDIUM'],
      [3, 'HIGH'],
    ])('%i -> %s', (potential, band) => {
      expect(potentialBand(potential)).toBe(band);
    });
  });
});
