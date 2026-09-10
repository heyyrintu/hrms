import { TaxAgeBand } from '@prisma/client';
import {
  ageBandOn31March,
  collectsProfessionalTaxIn,
  completedYearsBetween,
} from './tax-correctness.types';

describe('ageBandOn31March', () => {
  it('reads age as at the last day of the financial year, not the payroll date', () => {
    // Born 20 February 1967, so 60 on 20 February 2027, inside FY 2026-27.
    // They are a senior citizen for the whole of that year, including the
    // April payroll run that happened ten months before the birthday.
    const dob = new Date(Date.UTC(1967, 1, 20));
    expect(ageBandOn31March(dob, 2026)).toBe(TaxAgeBand.SENIOR);
  });

  it('does not promote somebody whose birthday falls after 31 March', () => {
    // Born 2 April 1967: still 59 on 31 March 2027.
    const dob = new Date(Date.UTC(1967, 3, 2));
    expect(ageBandOn31March(dob, 2026)).toBe(TaxAgeBand.GENERAL);
  });

  it('moves to the super senior band at eighty', () => {
    expect(ageBandOn31March(new Date(Date.UTC(1947, 0, 1)), 2026)).toBe(
      TaxAgeBand.SUPER_SENIOR,
    );
    // One day short of eighty on 31 March 2027.
    expect(ageBandOn31March(new Date(Date.UTC(1947, 3, 1)), 2026)).toBe(
      TaxAgeBand.SENIOR,
    );
  });

  it('falls back to the general band when no date of birth is on record', () => {
    // The safe direction: withhold the higher exemption rather than grant one
    // the employee may not be entitled to. The shortfall returns on assessment.
    expect(ageBandOn31March(null, 2026)).toBe(TaxAgeBand.GENERAL);
    expect(ageBandOn31March(undefined, 2026)).toBe(TaxAgeBand.GENERAL);
  });
});

describe('completedYearsBetween', () => {
  it('does not count a birthday that has not happened yet', () => {
    const from = new Date(Date.UTC(2000, 5, 15));
    expect(completedYearsBetween(from, new Date(Date.UTC(2026, 5, 14)))).toBe(25);
    expect(completedYearsBetween(from, new Date(Date.UTC(2026, 5, 15)))).toBe(26);
  });
});

describe('collectsProfessionalTaxIn', () => {
  it('collects every month when no months are configured', () => {
    // What most states do, and what this did before the column existed.
    for (let month = 1; month <= 12; month += 1) {
      expect(collectsProfessionalTaxIn(month, [])).toBe(true);
      expect(collectsProfessionalTaxIn(month, null)).toBe(true);
    }
  });

  it('collects only in the configured months for a half-yearly state', () => {
    // Deducting a half-yearly slab amount twelve times would take six times
    // what the state actually levies.
    const halfYearly = [3, 9];
    expect(collectsProfessionalTaxIn(3, halfYearly)).toBe(true);
    expect(collectsProfessionalTaxIn(9, halfYearly)).toBe(true);
    expect(collectsProfessionalTaxIn(4, halfYearly)).toBe(false);
    expect(collectsProfessionalTaxIn(12, halfYearly)).toBe(false);
  });
});
