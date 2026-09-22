import {
  buildSchedule,
  ceil2,
  computeEmi,
  computeTotalPayable,
  formatPeriod,
  round2,
} from './loanSchedule';

/**
 * These cases are deliberately the same ones the backend's loan-schedule spec
 * asserts. If the two ever drift, the EMI the employee agreed to in the form
 * stops matching the EMI payroll deducts, so the duplication is the point.
 */
describe('loanSchedule', () => {
  describe('computeTotalPayable', () => {
    it('leaves the principal alone at zero interest', () => {
      expect(computeTotalPayable(120000, 0, 12)).toBe(120000);
    });

    it('charges simple interest for the tenure, not per year', () => {
      expect(computeTotalPayable(120000, 10, 12)).toBe(132000);
      expect(computeTotalPayable(120000, 10, 6)).toBe(126000);
      expect(computeTotalPayable(120000, 10, 24)).toBe(144000);
    });
  });

  describe('rounding helpers', () => {
    it('rounds to paise', () => {
      expect(round2(3416.666)).toBe(3416.67);
      expect(round2(3416.664)).toBe(3416.66);
    });

    it('rounds the EMI up without inventing a paisa', () => {
      expect(ceil2(3416.661)).toBe(3416.67);
      expect(ceil2(1000)).toBe(1000);
      expect(ceil2(0.1 + 0.2)).toBe(0.3);
    });
  });

  describe('computeEmi', () => {
    it('divides evenly where it can', () => {
      expect(computeEmi(132000, 12)).toBe(11000);
    });

    it('rounds up otherwise', () => {
      expect(computeEmi(10250, 3)).toBe(3416.67);
    });
  });

  describe('buildSchedule', () => {
    it('produces a zero-interest advance with level instalments', () => {
      const rows = buildSchedule({
        principal: 12000,
        interestRate: 0,
        tenureMonths: 12,
        startMonth: 4,
        startYear: 2026,
      });

      expect(rows).toHaveLength(12);
      expect(rows.every((r) => r.interestComponent === 0)).toBe(true);
      expect(rows.every((r) => r.emi === 1000)).toBe(true);
      expect(rows[0]).toEqual({
        month: 4,
        year: 2026,
        emi: 1000,
        principalComponent: 1000,
        interestComponent: 0,
        balanceAfter: 11000,
      });
      expect(rows[11].balanceAfter).toBe(0);
    });

    it('spreads 10% over twelve months', () => {
      const rows = buildSchedule({
        principal: 120000,
        interestRate: 10,
        tenureMonths: 12,
        startMonth: 1,
        startYear: 2026,
      });

      expect(rows.every((r) => r.emi === 11000)).toBe(true);
      expect(rows.every((r) => r.interestComponent === 1000)).toBe(true);
      expect(rows[11].balanceAfter).toBe(0);
    });

    it('lets the last instalment absorb the rounding', () => {
      const rows = buildSchedule({
        principal: 10000,
        interestRate: 10,
        tenureMonths: 3,
        startMonth: 1,
        startYear: 2026,
      });

      expect(rows.map((r) => r.emi)).toEqual([3416.67, 3416.67, 3416.66]);
      expect(round2(rows.reduce((a, r) => a + r.emi, 0))).toBe(10250);
      expect(rows[2].balanceAfter).toBe(0);
    });

    it('rolls the month into the next year', () => {
      const rows = buildSchedule({
        principal: 3000,
        interestRate: 0,
        tenureMonths: 4,
        startMonth: 11,
        startYear: 2026,
      });

      expect(rows.map((r) => [r.month, r.year])).toEqual([
        [11, 2026],
        [12, 2026],
        [1, 2027],
        [2, 2027],
      ]);
    });

    it('returns nothing rather than throwing on a half-typed form', () => {
      expect(
        buildSchedule({
          principal: 0,
          interestRate: 0,
          tenureMonths: 12,
          startMonth: 1,
          startYear: 2026,
        }),
      ).toEqual([]);

      expect(
        buildSchedule({
          principal: 10000,
          interestRate: 0,
          tenureMonths: Number.NaN,
          startMonth: 1,
          startYear: 2026,
        }),
      ).toEqual([]);

      expect(
        buildSchedule({
          principal: 10000,
          interestRate: 0,
          tenureMonths: 6,
          startMonth: 0,
          startYear: 2026,
        }),
      ).toEqual([]);
    });
  });

  describe('formatPeriod', () => {
    it('names the month', () => {
      expect(formatPeriod(3, 2026)).toBe('Mar 2026');
      expect(formatPeriod(12, 2026)).toBe('Dec 2026');
    });

    it('falls back to digits for a month it cannot name', () => {
      expect(formatPeriod(13, 2026)).toBe('13/2026');
    });
  });
});
