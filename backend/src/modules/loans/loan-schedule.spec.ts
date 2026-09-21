import {
  buildSchedule,
  ceil2,
  computeEmi,
  computeTotalPayable,
  round2,
} from './loan-schedule';

describe('loan-schedule', () => {
  describe('computeTotalPayable', () => {
    it('returns the principal unchanged at zero interest', () => {
      expect(computeTotalPayable(120000, 0, 12)).toBe(120000);
    });

    it('applies simple interest over the tenure, not per year', () => {
      // 10% of 120000 for a full year.
      expect(computeTotalPayable(120000, 10, 12)).toBe(132000);
      // The same rate over six months is half the interest.
      expect(computeTotalPayable(120000, 10, 6)).toBe(126000);
      // And over two years, double it.
      expect(computeTotalPayable(120000, 10, 24)).toBe(144000);
    });
  });

  describe('rounding helpers', () => {
    it('rounds to paise', () => {
      expect(round2(3416.666)).toBe(3416.67);
      expect(round2(3416.664)).toBe(3416.66);
    });

    it('rounds the EMI up', () => {
      expect(ceil2(3416.661)).toBe(3416.67);
      expect(ceil2(1000)).toBe(1000);
    });

    it('does not round a float artefact up a whole paisa', () => {
      expect(ceil2(0.1 + 0.2)).toBe(0.3);
    });
  });

  describe('computeEmi', () => {
    it('divides evenly when the tenure divides the total', () => {
      expect(computeEmi(132000, 12)).toBe(11000);
    });

    it('rounds up so instalments never undershoot', () => {
      expect(computeEmi(10250, 3)).toBe(3416.67);
    });
  });

  describe('buildSchedule', () => {
    it('produces one row per month of the tenure', () => {
      const rows = buildSchedule({
        principal: 12000,
        interestRate: 0,
        tenureMonths: 12,
        startMonth: 1,
        startYear: 2026,
      });
      expect(rows).toHaveLength(12);
    });

    it('charges no interest on a zero-interest advance', () => {
      const rows = buildSchedule({
        principal: 12000,
        interestRate: 0,
        tenureMonths: 12,
        startMonth: 4,
        startYear: 2026,
      });

      expect(rows.every((r) => r.interestComponent === 0)).toBe(true);
      expect(rows.every((r) => r.emi === 1000)).toBe(true);
      expect(rows.every((r) => r.principalComponent === 1000)).toBe(true);
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

    it('spreads 10% simple interest evenly over twelve months', () => {
      const rows = buildSchedule({
        principal: 120000,
        interestRate: 10,
        tenureMonths: 12,
        startMonth: 1,
        startYear: 2026,
      });

      expect(rows).toHaveLength(12);
      expect(rows.every((r) => r.emi === 11000)).toBe(true);
      expect(rows.every((r) => r.interestComponent === 1000)).toBe(true);
      expect(rows.every((r) => r.principalComponent === 10000)).toBe(true);
      expect(rows[0].balanceAfter).toBe(121000);
      expect(rows[11].balanceAfter).toBe(0);
    });

    it('lets the last row absorb the rounding so the rows sum to the total', () => {
      const rows = buildSchedule({
        principal: 10000,
        interestRate: 10,
        tenureMonths: 3,
        startMonth: 1,
        startYear: 2026,
      });

      const totalPayable = computeTotalPayable(10000, 10, 3);
      expect(totalPayable).toBe(10250);

      expect(rows[0].emi).toBe(3416.67);
      expect(rows[1].emi).toBe(3416.67);
      // Short by the two paise the first rows rounded up.
      expect(rows[2].emi).toBe(3416.66);

      const sum = round2(rows.reduce((acc, r) => acc + r.emi, 0));
      expect(sum).toBe(totalPayable);
      expect(rows[2].balanceAfter).toBe(0);
    });

    it('keeps principal and interest components summing to the EMI', () => {
      const rows = buildSchedule({
        principal: 10000,
        interestRate: 7.5,
        tenureMonths: 7,
        startMonth: 1,
        startYear: 2026,
      });

      for (const row of rows) {
        expect(round2(row.principalComponent + row.interestComponent)).toBe(
          row.emi,
        );
      }

      const interest = round2(
        rows.reduce((acc, r) => acc + r.interestComponent, 0),
      );
      const principal = round2(
        rows.reduce((acc, r) => acc + r.principalComponent, 0),
      );
      expect(round2(principal + interest)).toBe(
        computeTotalPayable(10000, 7.5, 7),
      );
      expect(principal).toBe(10000);
    });

    it('rolls the month over into the next year', () => {
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

    it('rolls over more than one year for a long tenure', () => {
      const rows = buildSchedule({
        principal: 100000,
        interestRate: 0,
        tenureMonths: 26,
        startMonth: 12,
        startYear: 2026,
      });

      expect(rows[0]).toMatchObject({ month: 12, year: 2026 });
      expect(rows[1]).toMatchObject({ month: 1, year: 2027 });
      expect(rows[13]).toMatchObject({ month: 1, year: 2028 });
      expect(rows[25]).toMatchObject({ month: 1, year: 2029 });
    });

    it('handles a single-month advance', () => {
      const rows = buildSchedule({
        principal: 5000,
        interestRate: 0,
        tenureMonths: 1,
        startMonth: 6,
        startYear: 2026,
      });

      expect(rows).toEqual([
        {
          month: 6,
          year: 2026,
          emi: 5000,
          principalComponent: 5000,
          interestComponent: 0,
          balanceAfter: 0,
        },
      ]);
    });

    it('rejects a non-positive tenure and an out-of-range start month', () => {
      expect(() =>
        buildSchedule({
          principal: 1000,
          interestRate: 0,
          tenureMonths: 0,
          startMonth: 1,
          startYear: 2026,
        }),
      ).toThrow('tenureMonths must be a positive integer');

      expect(() =>
        buildSchedule({
          principal: 1000,
          interestRate: 0,
          tenureMonths: 3,
          startMonth: 13,
          startYear: 2026,
        }),
      ).toThrow('startMonth must be between 1 and 12');
    });
  });
});
