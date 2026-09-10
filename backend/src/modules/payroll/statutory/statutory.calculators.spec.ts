import { Decimal } from '@prisma/client/runtime/library';
import { TaxAgeBand } from '@prisma/client';
import {
  calculatePf,
  calculateEsi,
  calculateProfessionalTax,
  calculateLwf,
  calculateIncomeTax,
  calculateSurcharge,
  monthlyTdsInstalment,
} from './statutory.calculators';

const d = (n: number | string) => new Decimal(n);

const pfConfig = {
  pfEnabled: true,
  pfEmployeeRate: d(12),
  pfEmployerRate: d(12),
  epsRate: d(8.33),
  pfWageCeiling: d(15000),
  applyPfCeiling: true,
  edliRate: d(0.5),
  pfAdminRate: d(0.5),
};

describe('calculatePf', () => {
  it('caps every share at the wage ceiling when the employer applies it', () => {
    const r = calculatePf(d(20000), pfConfig, false);

    // 12% of the capped 15,000
    expect(r.employee.toString()).toBe('1800');
    // 8.33% of 15,000 is 1,249.50, which EPFO rounds to the familiar 1,250
    expect(r.eps.toString()).toBe('1250');
    // The employer's 12% is 1,800, of which EPS takes 1,250
    expect(r.employerPf.toString()).toBe('550');
    expect(r.edli.toString()).toBe('75');
    expect(r.admin.toString()).toBe('75');
    expect(r.pfWages.toString()).toBe('15000');
  });

  it('uses actual wages when they fall below the ceiling', () => {
    const r = calculatePf(d(10000), pfConfig, false);

    expect(r.employee.toString()).toBe('1200');
    expect(r.eps.toString()).toBe('833');
    expect(r.employerPf.toString()).toBe('367');
    expect(r.edli.toString()).toBe('50');
  });

  it('contributes on full wages when the employer waives the ceiling, but still caps the pension share', () => {
    const r = calculatePf(d(20000), { ...pfConfig, applyPfCeiling: false }, false);

    expect(r.employee.toString()).toBe('2400');
    // EPS is capped at the ceiling by statute regardless of employer policy
    expect(r.eps.toString()).toBe('1250');
    expect(r.employerPf.toString()).toBe('1150');
    expect(r.pfWages.toString()).toBe('20000');
  });

  it('contributes nothing for an excluded employee', () => {
    const r = calculatePf(d(20000), pfConfig, true);

    expect(r.employee.toString()).toBe('0');
    expect(r.employerPf.toString()).toBe('0');
    expect(r.eps.toString()).toBe('0');
  });

  it('contributes nothing when the establishment has PF switched off', () => {
    const r = calculatePf(d(20000), { ...pfConfig, pfEnabled: false }, false);

    expect(r.employee.toString()).toBe('0');
  });
});

const esiConfig = {
  esiEnabled: true,
  esiEmployeeRate: d(0.75),
  esiEmployerRate: d(3.25),
  esiWageLimit: d(21000),
};

describe('calculateEsi', () => {
  it('rounds each share up to the next rupee', () => {
    // 0.75% of 17,875 is 134.0625; 3.25% is 580.9375
    const r = calculateEsi(d(17875), esiConfig, false);

    expect(r.covered).toBe(true);
    expect(r.employee.toString()).toBe('135');
    expect(r.employer.toString()).toBe('581');
  });

  it('covers an employee exactly on the wage limit', () => {
    const r = calculateEsi(d(21000), esiConfig, false);

    expect(r.covered).toBe(true);
    expect(r.employee.toString()).toBe('158'); // 157.50 rounded up
    expect(r.employer.toString()).toBe('683'); // 682.50 rounded up
  });

  it('excludes an employee above the wage limit', () => {
    const r = calculateEsi(d(25000), esiConfig, false);

    expect(r.covered).toBe(false);
    expect(r.employee.toString()).toBe('0');
    expect(r.employer.toString()).toBe('0');
  });

  it('keeps deducting for the rest of the contribution period once someone crosses the limit', () => {
    // Statutory rule: crossing the limit mid-period does not end coverage
    // until the period does, so the caller passes continuedFromPeriod.
    const r = calculateEsi(d(25000), esiConfig, true);

    expect(r.covered).toBe(true);
    expect(r.employee.toString()).toBe('188'); // 187.50 rounded up
  });
});

const karnatakaSlabs = [
  { fromAmount: d(0), toAmount: d(24999.99), amount: d(0), februaryAmount: null, gender: null },
  { fromAmount: d(25000), toAmount: null, amount: d(200), februaryAmount: null, gender: null },
];

describe('calculateProfessionalTax', () => {
  it('picks the slab the monthly gross falls in', () => {
    expect(calculateProfessionalTax(d(30000), karnatakaSlabs, 5, null).toString()).toBe('200');
    expect(calculateProfessionalTax(d(20000), karnatakaSlabs, 5, null).toString()).toBe('0');
  });

  it('uses the February override where a state charges a different figure that month', () => {
    const maharashtra = [
      { fromAmount: d(10001), toAmount: null, amount: d(200), februaryAmount: d(300), gender: null },
    ];

    expect(calculateProfessionalTax(d(50000), maharashtra, 1, null).toString()).toBe('200');
    expect(calculateProfessionalTax(d(50000), maharashtra, 2, null).toString()).toBe('300');
  });

  it('honours a gender-specific slab where the state distinguishes', () => {
    const slabs = [
      { fromAmount: d(0), toAmount: d(25000), amount: d(0), februaryAmount: null, gender: 'Female' },
      { fromAmount: d(0), toAmount: d(7500), amount: d(0), februaryAmount: null, gender: 'Male' },
      { fromAmount: d(7501), toAmount: null, amount: d(200), februaryAmount: null, gender: 'Male' },
    ];

    expect(calculateProfessionalTax(d(20000), slabs, 5, 'Female').toString()).toBe('0');
    expect(calculateProfessionalTax(d(20000), slabs, 5, 'Male').toString()).toBe('200');
  });

  it('charges nothing when no slab matches', () => {
    expect(calculateProfessionalTax(d(30000), [], 5, null).toString()).toBe('0');
  });
});

describe('calculateLwf', () => {
  const cfg = {
    lwfEnabled: true,
    lwfEmployeeAmount: d(25),
    lwfEmployerAmount: d(50),
    lwfMonths: [6, 12],
  };

  it('deducts only in the months the state collects', () => {
    expect(calculateLwf(cfg, 6).employee.toString()).toBe('25');
    expect(calculateLwf(cfg, 6).employer.toString()).toBe('50');
    expect(calculateLwf(cfg, 7).employee.toString()).toBe('0');
  });

  it('deducts nothing when the fund does not apply', () => {
    expect(calculateLwf({ ...cfg, lwfEnabled: false }, 6).employee.toString()).toBe('0');
  });
});

// FY 2025-26 parameters, as shipped in the seed.
const newRegime = {
  regime: 'NEW' as const,
  standardDeduction: d(75000),
  rebateIncomeLimit: d(1200000),
  rebateMaxAmount: d(60000),
  cessRate: d(4),
  surchargeSlabs: [
    { threshold: 5000000, rate: 10 },
    { threshold: 10000000, rate: 15 },
    { threshold: 20000000, rate: 25 },
  ],
  slabs: [
    { fromAmount: d(0), toAmount: d(400000), rate: d(0) },
    { fromAmount: d(400000), toAmount: d(800000), rate: d(5) },
    { fromAmount: d(800000), toAmount: d(1200000), rate: d(10) },
    { fromAmount: d(1200000), toAmount: d(1600000), rate: d(15) },
    { fromAmount: d(1600000), toAmount: d(2000000), rate: d(20) },
    { fromAmount: d(2000000), toAmount: d(2400000), rate: d(25) },
    { fromAmount: d(2400000), toAmount: null, rate: d(30) },
  ],
};

const oldRegime = {
  regime: 'OLD' as const,
  standardDeduction: d(50000),
  rebateIncomeLimit: d(500000),
  rebateMaxAmount: d(12500),
  cessRate: d(4),
  surchargeSlabs: [],
  slabs: [
    { fromAmount: d(0), toAmount: d(250000), rate: d(0) },
    { fromAmount: d(250000), toAmount: d(500000), rate: d(5) },
    { fromAmount: d(500000), toAmount: d(1000000), rate: d(20) },
    { fromAmount: d(1000000), toAmount: null, rate: d(30) },
  ],
};

const noDeclarations = {
  section80C: d(0),
  section80D: d(0),
  section80CCD1B: d(0),
  section80CCD2: d(0),
  hraExemption: d(0),
  homeLoanInterest: d(0),
  otherDeductions: d(0),
  otherIncome: d(0),
  previousEmployerTds: d(0),
};

describe('calculateIncomeTax', () => {
  it('taxes nothing under the new regime at 12 lakh, where the rebate wipes out the liability', () => {
    // 12,00,000 less the 75,000 standard deduction is 11,25,000 taxable.
    // 5% of 4L = 20,000, plus 10% of 3.25L = 32,500, so 52,500 before rebate.
    // Taxable income is under the 12,00,000 rebate limit, so it all goes.
    const r = calculateIncomeTax(d(1200000), newRegime, noDeclarations, d(0));

    expect(r.taxableIncome.toString()).toBe('1125000');
    expect(r.taxBeforeRebate.toString()).toBe('52500');
    expect(r.rebate.toString()).toBe('52500');
    expect(r.totalTax.toString()).toBe('0');
  });

  it('applies slabs and cess under the new regime above the rebate limit', () => {
    // 15,00,000 less 75,000 is 14,25,000 taxable.
    // 20,000 + 40,000 + 15% of 2,25,000 (33,750) = 93,750, plus 4% cess.
    const r = calculateIncomeTax(d(1500000), newRegime, noDeclarations, d(0));

    expect(r.taxableIncome.toString()).toBe('1425000');
    expect(r.taxBeforeRebate.toString()).toBe('93750');
    expect(r.rebate.toString()).toBe('0');
    expect(r.cess.toString()).toBe('3750');
    expect(r.totalTax.toString()).toBe('97500');
  });

  it('allows chapter VI-A deductions under the old regime', () => {
    // 10,00,000 less 50,000 standard less 1,50,000 of 80C is 8,00,000.
    // 12,500 + 20% of 3,00,000 (60,000) = 72,500, plus 4% cess.
    const r = calculateIncomeTax(
      d(1000000),
      oldRegime,
      { ...noDeclarations, section80C: d(150000) },
      d(0),
    );

    expect(r.taxableIncome.toString()).toBe('800000');
    expect(r.taxBeforeRebate.toString()).toBe('72500');
    expect(r.totalTax.toString()).toBe('75400');
  });

  it('ignores old-regime deductions under the new regime, except 80CCD(2)', () => {
    const withDeclarations = {
      ...noDeclarations,
      section80C: d(150000),
      hraExemption: d(200000),
      section80CCD2: d(50000),
    };

    const r = calculateIncomeTax(d(1500000), newRegime, withDeclarations, d(0));

    // Only the employer NPS contribution comes off: 14,25,000 - 50,000
    expect(r.taxableIncome.toString()).toBe('1375000');
  });

  it('subtracts professional tax paid, which section 16 allows under the old regime', () => {
    const r = calculateIncomeTax(d(1000000), oldRegime, noDeclarations, d(2400));

    // 10,00,000 - 50,000 standard - 2,400 professional tax
    expect(r.taxableIncome.toString()).toBe('947600');
  });

  it('adds surcharge above the first threshold', () => {
    // 60,00,000 less 75,000 is 59,25,000, which is over the 50 lakh threshold.
    const r = calculateIncomeTax(d(6000000), newRegime, noDeclarations, d(0));

    expect(r.surcharge.gt(0)).toBe(true);
    // Surcharge is 10% of the tax, and cess then applies to both
    expect(r.surcharge.toString()).toBe(r.taxBeforeRebate.mul(0.1).toDecimalPlaces(0).toString());
  });

  it('never returns a negative liability', () => {
    const r = calculateIncomeTax(d(300000), newRegime, noDeclarations, d(0));

    expect(r.totalTax.toString()).toBe('0');
  });
});

describe('monthlyTdsInstalment', () => {
  it('spreads the remaining liability over the months left in the year', () => {
    // 97,500 due, 20,000 already deducted, 5 months left
    expect(monthlyTdsInstalment(d(97500), d(20000), 5).toString()).toBe('15500');
  });

  it('credits tax deducted by a previous employer', () => {
    expect(monthlyTdsInstalment(d(97500), d(97500), 5).toString()).toBe('0');
  });

  it('does not refund when more has already been deducted than is due', () => {
    expect(monthlyTdsInstalment(d(50000), d(80000), 3).toString()).toBe('0');
  });

  it('takes the whole balance in the final month', () => {
    expect(monthlyTdsInstalment(d(97500), d(90000), 1).toString()).toBe('7500');
  });
});

// ---------------------------------------------------------------------------
// Defect 1: marginal relief on surcharge
// ---------------------------------------------------------------------------

describe('calculateIncomeTax: marginal relief on surcharge', () => {
  it('charges one more rupee of tax for one more rupee of income at the 50 lakh threshold', () => {
    // Two runs a rupee apart. The whole point of marginal relief is that the
    // second may not cost more than the first plus the rupee that was earned.
    //
    // Taxable exactly 50,00,000 (gross 50,75,000 less the 75,000 standard
    // deduction). New-regime slabs: 20,000 + 40,000 + 60,000 + 80,000 +
    // 1,00,000 for the bands up to 24,00,000, then 30% of 26,00,000 =
    // 7,80,000. Tax = 10,80,000. Income is not *above* 50,00,000, so no
    // surcharge. Cess 4% = 43,200. Total 11,23,200.
    const at = calculateIncomeTax(d(5075000), newRegime, noDeclarations, d(0));

    expect(at.taxableIncome.toString()).toBe('5000000');
    expect(at.surcharge.toString()).toBe('0');
    expect(at.totalTax.toString()).toBe('1123200');

    // One rupee more. Tax on the extra rupee is 30 paise, which rounds away,
    // so tax is still 10,80,000 and surcharge before relief is 10% = 1,08,000.
    // Relief caps tax-plus-surcharge at the threshold figure plus the extra
    // income: 10,80,000 + 1 = 10,80,001. So relief is
    // (10,80,000 + 1,08,000) - 10,80,001 = 1,07,999 and the surcharge left
    // standing is 1,08,000 - 1,07,999 = 1 rupee.
    // Cess 4% of (10,80,000 + 1) = 43,200.04, rounded to 43,200.
    const above = calculateIncomeTax(d(5075001), newRegime, noDeclarations, d(0));

    expect(above.taxableIncome.toString()).toBe('5000001');
    expect(above.surchargeBeforeRelief.toString()).toBe('108000');
    expect(above.marginalRelief.toString()).toBe('107999');
    expect(above.surcharge.toString()).toBe('1');
    expect(above.reliefThreshold?.toString()).toBe('5000000');
    expect(above.totalTax.toString()).toBe('1123201');
  });
});

describe('calculateSurcharge', () => {
  // Every figure below uses the new-regime slabs above. Tax on any taxable
  // income at or above 24,00,000 is 3,00,000 for the bands beneath it
  // (20,000 + 40,000 + 60,000 + 80,000 + 1,00,000) plus 30% of the rest.

  it('charges nothing below the first threshold', () => {
    // 49,99,999 has not crossed 50,00,000, so there is no surcharge to relieve.
    const r = calculateSurcharge(d(4999999), d(1080000), newRegime);

    expect(r.surcharge.toString()).toBe('0');
    expect(r.surchargeBeforeRelief.toString()).toBe('0');
    expect(r.marginalRelief.toString()).toBe('0');
    expect(r.reliefThreshold).toBeNull();
  });

  it('charges nothing sitting exactly on a threshold', () => {
    // Above, not at: 50,00,000 is not more than 50,00,000.
    const r = calculateSurcharge(d(5000000), d(1080000), newRegime);

    expect(r.surcharge.toString()).toBe('0');
    expect(r.reliefThreshold).toBeNull();
  });

  it('relieves all but the extra rupee one rupee above the 50 lakh threshold', () => {
    // Tax at 50,00,000: 3,00,000 + 30% of 26,00,000 = 10,80,000, and no
    // surcharge, since 50,00,000 is not above 50,00,000.
    // At 50,00,001 the tax is the same 10,80,000 once the 30 paise round away.
    // Surcharge before relief: 10% of 10,80,000 = 1,08,000.
    // Cap: 10,80,000 + 1 = 10,80,001. Actual: 10,80,000 + 1,08,000 = 11,88,000.
    // Relief: 11,88,000 - 10,80,001 = 1,07,999. Surcharge left: 1 rupee.
    const r = calculateSurcharge(d(5000001), d(1080000), newRegime);

    expect(r.surchargeBeforeRelief.toString()).toBe('108000');
    expect(r.marginalRelief.toString()).toBe('107999');
    expect(r.surcharge.toString()).toBe('1');
    expect(r.reliefThreshold?.toString()).toBe('5000000');
  });

  it('measures the second threshold against the 10% surcharge below it', () => {
    // Tax at 1,00,00,000: 3,00,000 + 30% of 76,00,000 = 25,80,000.
    // Surcharge there is the band below, 10% of 25,80,000 = 2,58,000, so the
    // liability at the threshold is 28,38,000.
    // At 1,00,00,001 the tax is still 25,80,000 and surcharge before relief is
    // 15% = 3,87,000, giving 29,67,000 against a cap of 28,38,001.
    // Relief 1,28,999, leaving 3,87,000 - 1,28,999 = 2,58,001 of surcharge:
    // the 10% figure from the threshold, plus the rupee that was earned.
    const r = calculateSurcharge(d(10000001), d(2580000), newRegime);

    expect(r.surchargeBeforeRelief.toString()).toBe('387000');
    expect(r.marginalRelief.toString()).toBe('128999');
    expect(r.surcharge.toString()).toBe('258001');
    expect(r.reliefThreshold?.toString()).toBe('10000000');
  });

  it('measures the third threshold against the 15% surcharge below it', () => {
    // Tax at 2,00,00,000: 3,00,000 + 30% of 1,76,00,000 = 55,80,000.
    // Surcharge there is 15% = 8,37,000, so the threshold liability is
    // 64,17,000. At 2,00,00,001, surcharge before relief is 25% = 13,95,000
    // and the liability 69,75,000 against a cap of 64,17,001.
    // Relief 5,57,999, leaving 8,37,001 — the 15% figure plus the extra rupee.
    const r = calculateSurcharge(d(20000001), d(5580000), newRegime);

    expect(r.surchargeBeforeRelief.toString()).toBe('1395000');
    expect(r.marginalRelief.toString()).toBe('557999');
    expect(r.surcharge.toString()).toBe('837001');
  });

  it('does not bite well above a threshold', () => {
    // Taxable 80,00,000: tax 3,00,000 + 30% of 56,00,000 = 19,80,000, and
    // surcharge 10% = 1,98,000, so 21,78,000 in all. The cap is the threshold
    // liability of 10,80,000 plus the 30,00,000 of income above it, which is
    // 40,80,000 — far more than the liability, so relief is nil and the full
    // flat surcharge stands.
    const r = calculateSurcharge(d(8000000), d(1980000), newRegime);

    expect(r.surchargeBeforeRelief.toString()).toBe('198000');
    expect(r.marginalRelief.toString()).toBe('0');
    expect(r.surcharge.toString()).toBe('198000');
  });

  it('charges the flat rate when the year is configured without relief', () => {
    // Same rupee-above-the-threshold case as before, with relief switched off:
    // the full 1,08,000 stands, which is exactly what this did before relief
    // was implemented.
    const r = calculateSurcharge(d(5000001), d(1080000), {
      ...newRegime,
      marginalReliefEnabled: false,
    });

    expect(r.surcharge.toString()).toBe('108000');
    expect(r.surchargeBeforeRelief.toString()).toBe('108000');
    expect(r.marginalRelief.toString()).toBe('0');
    expect(r.reliefThreshold).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Defect 2: chapter VI-A ceilings
// ---------------------------------------------------------------------------

// FY 2025-26 ceilings, as held on the year's configuration row.
const limits = {
  section80C: d(150000),
  section80D: d(25000),
  section80CCD1B: d(50000),
};

const oldRegimeWithLimits = { ...oldRegime, limits };

describe('calculateIncomeTax: chapter VI-A ceilings', () => {
  // Gross 12,00,000, old regime. Over-claimed on all three capped heads:
  // 80C 2,00,000 against a ceiling of 1,50,000; 80D 40,000 against 25,000;
  // 80CCD(1B) 75,000 against 50,000.
  const overClaimed = {
    ...noDeclarations,
    section80C: d(200000),
    section80D: d(40000),
    section80CCD1B: d(75000),
  };

  it('allows only the statutory maximum under each capped head', () => {
    // Allowed: 1,50,000 + 25,000 + 50,000 = 2,25,000, plus the 50,000
    // standard deduction, so 2,75,000 comes off and 9,25,000 is taxable.
    // Old slabs: 5% of 2,50,000 = 12,500, then 20% of 4,25,000 = 85,000,
    // so 97,500 of tax. Cess 4% = 3,900. Total 1,01,400.
    //
    // Taken as declared it would have been 3,65,000 of deductions, 8,35,000
    // taxable and 82,680 of tax: 18,720 less than the statute allows.
    const r = calculateIncomeTax(d(1200000), oldRegimeWithLimits, overClaimed, d(0));

    expect(r.totalDeductions.toString()).toBe('275000');
    expect(r.taxableIncome.toString()).toBe('925000');
    expect(r.taxBeforeRebate.toString()).toBe('97500');
    expect(r.totalTax.toString()).toBe('101400');
  });

  it('shows what was declared against what was allowed under each head', () => {
    const r = calculateIncomeTax(d(1200000), oldRegimeWithLimits, overClaimed, d(0));

    expect(r.chapterVIACaps.map((c) => c.section)).toEqual(['80C', '80D', '80CCD(1B)']);

    const [c80C, c80D, c80CCD1B] = r.chapterVIACaps;

    expect(c80C.declared.toString()).toBe('200000');
    expect(c80C.limit.toString()).toBe('150000');
    expect(c80C.allowed.toString()).toBe('150000');
    expect(c80C.disallowed.toString()).toBe('50000');

    expect(c80D.allowed.toString()).toBe('25000');
    expect(c80D.disallowed.toString()).toBe('15000');

    expect(c80CCD1B.allowed.toString()).toBe('50000');
    expect(c80CCD1B.disallowed.toString()).toBe('25000');
  });

  it('caps an approved figure exactly as it caps a declared one', () => {
    // Verified proofs reach the calculation through the same field, so this is
    // the same arithmetic. It is asserted anyway because the reasoning matters:
    // a reviewer who accepted evidence for 2,00,000 of 80C investment
    // confirmed the investment. They did not raise the limit.
    const approved = { ...noDeclarations, section80C: d(200000) };
    const r = calculateIncomeTax(d(1200000), oldRegimeWithLimits, approved, d(0));

    // 50,000 standard + 1,50,000 allowed, not the 2,00,000 that was proved.
    expect(r.totalDeductions.toString()).toBe('200000');
    expect(r.chapterVIACaps[0].disallowed.toString()).toBe('50000');
  });

  it('leaves a claim within the ceiling alone', () => {
    const within = {
      ...noDeclarations,
      section80C: d(120000),
      section80D: d(20000),
      section80CCD1B: d(50000),
    };

    const r = calculateIncomeTax(d(1200000), oldRegimeWithLimits, within, d(0));

    // 50,000 + 1,20,000 + 20,000 + 50,000
    expect(r.totalDeductions.toString()).toBe('240000');
    expect(r.chapterVIACaps.every((c) => c.disallowed.isZero())).toBe(true);
    expect(r.chapterVIACaps[2].allowed.toString()).toBe('50000');
  });

  it('falls back to the statutory ceilings when the year supplies none', () => {
    // A caller that has not been updated to pass the year's row still gets the
    // cap, because capping is the correct behaviour and 1,50,000 / 25,000 /
    // 50,000 are both the statute and the schema's defaults.
    const r = calculateIncomeTax(d(1200000), oldRegime, overClaimed, d(0));

    expect(r.totalDeductions.toString()).toBe('275000');
    expect(r.totalTax.toString()).toBe('101400');
  });

  it('lists no capped heads under the new regime, where none is available', () => {
    const r = calculateIncomeTax(d(1200000), { ...newRegime, limits }, overClaimed, d(0));

    expect(r.chapterVIACaps).toEqual([]);
    // Only the 75,000 standard deduction comes off.
    expect(r.taxableIncome.toString()).toBe('1125000');
  });
});

// ---------------------------------------------------------------------------
// Defect 3: age-banded basic exemption
// ---------------------------------------------------------------------------

// The old regime's basic exemption rises with age. The rows are seeded per
// band and the caller loads the one that matches; the slabs themselves are the
// only thing that differs.
const seniorRegime = {
  ...oldRegime,
  limits,
  ageBand: TaxAgeBand.SENIOR,
  slabs: [
    { fromAmount: d(0), toAmount: d(300000), rate: d(0) },
    { fromAmount: d(300000), toAmount: d(500000), rate: d(5) },
    { fromAmount: d(500000), toAmount: d(1000000), rate: d(20) },
    { fromAmount: d(1000000), toAmount: null, rate: d(30) },
  ],
};

const superSeniorRegime = {
  ...oldRegime,
  limits,
  ageBand: TaxAgeBand.SUPER_SENIOR,
  slabs: [
    { fromAmount: d(0), toAmount: d(500000), rate: d(0) },
    { fromAmount: d(500000), toAmount: d(1000000), rate: d(20) },
    { fromAmount: d(1000000), toAmount: null, rate: d(30) },
  ],
};

describe('calculateIncomeTax: age-banded basic exemption', () => {
  // The same 10,00,000 salary in all three, less the 50,000 standard
  // deduction, so 9,50,000 is taxable every time and only the exemption moves.
  const gross = d(1000000);

  it('taxes an individual below 60 from 2,50,000', () => {
    // 5% of 2,50,000 = 12,500, then 20% of 4,50,000 = 90,000. Tax 1,02,500,
    // cess 4,100, total 1,06,600.
    const r = calculateIncomeTax(gross, { ...oldRegime, limits }, noDeclarations, d(0));

    expect(r.taxableIncome.toString()).toBe('950000');
    expect(r.taxBeforeRebate.toString()).toBe('102500');
    expect(r.totalTax.toString()).toBe('106600');
    // Absent on the configuration means the general band, which is what an
    // employee with no recorded date of birth is treated as.
    expect(r.ageBand).toBe(TaxAgeBand.GENERAL);
  });

  it('exempts the first 3,00,000 for a senior citizen', () => {
    // 5% of 2,00,000 = 10,000, then 20% of 4,50,000 = 90,000. Tax 1,00,000,
    // cess 4,000, total 1,04,000 — 2,600 less than the general band, being 5%
    // of the extra 50,000 of exemption and the cess on it.
    const r = calculateIncomeTax(gross, seniorRegime, noDeclarations, d(0));

    expect(r.taxableIncome.toString()).toBe('950000');
    expect(r.taxBeforeRebate.toString()).toBe('100000');
    expect(r.totalTax.toString()).toBe('104000');
    expect(r.ageBand).toBe(TaxAgeBand.SENIOR);
  });

  it('exempts the first 5,00,000 for a super senior citizen', () => {
    // Nothing to 5,00,000, then 20% of 4,50,000 = 90,000. Cess 3,600,
    // total 93,600.
    const r = calculateIncomeTax(gross, superSeniorRegime, noDeclarations, d(0));

    expect(r.taxBeforeRebate.toString()).toBe('90000');
    expect(r.totalTax.toString()).toBe('93600');
    expect(r.ageBand).toBe(TaxAgeBand.SUPER_SENIOR);
  });
});

// ---------------------------------------------------------------------------
// Defect 4: half-yearly professional tax
// ---------------------------------------------------------------------------

describe('calculateProfessionalTax: collection months', () => {
  // A half-yearly state. The slab amount is the figure for the period, not for
  // a month, so deducting it every month would take six times the levy.
  const halfYearly = [
    { fromAmount: d(75001), toAmount: null, amount: d(1250), februaryAmount: null, gender: null },
  ];

  it('deducts the period amount only in the months the state collects', () => {
    // Configured to collect in April and October. Over the year that is
    // 1,250 twice, which is the 2,500 the state levies — not the 15,000 that
    // twelve monthly deductions would have taken.
    const months = [4, 10];

    expect(calculateProfessionalTax(d(90000), halfYearly, 4, null, months).toString()).toBe('1250');
    expect(calculateProfessionalTax(d(90000), halfYearly, 10, null, months).toString()).toBe('1250');
    expect(calculateProfessionalTax(d(90000), halfYearly, 5, null, months).toString()).toBe('0');
    expect(calculateProfessionalTax(d(90000), halfYearly, 3, null, months).toString()).toBe('0');

    const year = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].reduce(
      (total, m) => total.add(calculateProfessionalTax(d(90000), halfYearly, m, null, months)),
      d(0),
    );
    expect(year.toString()).toBe('2500');
  });

  it('collects every month when the state lists none, as most states do', () => {
    // An empty list is what the column defaults to, so every tenant that
    // existed before it did keeps deducting monthly exactly as it did.
    expect(calculateProfessionalTax(d(30000), karnatakaSlabs, 5, null, []).toString()).toBe('200');
    expect(calculateProfessionalTax(d(30000), karnatakaSlabs, 5, null).toString()).toBe('200');
  });

  it('still applies the February override where February is a collection month', () => {
    const maharashtra = [
      { fromAmount: d(10001), toAmount: null, amount: d(200), februaryAmount: d(300), gender: null },
    ];

    expect(calculateProfessionalTax(d(50000), maharashtra, 2, null, [2, 8]).toString()).toBe('300');
    expect(calculateProfessionalTax(d(50000), maharashtra, 3, null, [2, 8]).toString()).toBe('0');
  });
});

// ---------------------------------------------------------------------------
// Section 10 exemptions beyond house rent
// ---------------------------------------------------------------------------

// FY 2025-26 section 10(14) ceilings, as held on the year's configuration row.
// Held as data, not written into the calculation: the Finance Act moves them.
const section10Limits = {
  childrenEducationMonthlyLimit: d(100),
  hostelAllowanceMonthlyLimit: d(300),
  maxChildren: 2,
};

const oldRegimeWithSection10 = { ...oldRegimeWithLimits, section10Limits };

describe('calculateIncomeTax: section 10 exemptions beyond house rent', () => {
  it('caps the education allowance at the monthly ceiling per child', () => {
    // One child, 5,000 declared for the year. The section allows 100 a month
    // per child: 100 x 12 x 1 = 1,200. So 1,200 is exempt and 3,800 is not.
    //
    // Gross 12,00,000, old regime. Deductions 50,000 standard + 1,200 = 51,200,
    // so 11,48,800 is taxable. Old slabs: 2,50,000 at nil, 2,50,000 at 5% =
    // 12,500, 5,00,000 at 20% = 1,00,000, 1,48,800 at 30% = 44,640. Tax
    // 1,57,140, cess at 4% = 6,285.60 -> 6,286, total 1,63,426.
    //
    // Taken at the declared 5,000 it would have been 11,45,000 taxable,
    // 1,56,000 of tax and 1,62,240 in total: 1,186 too little.
    const r = calculateIncomeTax(
      d(1200000),
      oldRegimeWithSection10,
      { ...noDeclarations, childrenEducationAllowance: d(5000), childrenCount: 1 },
      d(0),
    );

    expect(r.totalDeductions.toString()).toBe('51200');
    expect(r.taxableIncome.toString()).toBe('1148800');
    expect(r.taxBeforeRebate.toString()).toBe('157140');
    expect(r.totalTax.toString()).toBe('163426');
  });

  it('counts at most two children, however many are declared', () => {
    // Three children, 10,000 declared. The section stops at two, so the
    // ceiling is 100 x 12 x 2 = 2,400, not 3,600.
    const r = calculateIncomeTax(
      d(1200000),
      oldRegimeWithSection10,
      { ...noDeclarations, childrenEducationAllowance: d(10000), childrenCount: 3 },
      d(0),
    );

    const education = r.section10Exemptions.find((e) => e.head === 'CHILDREN_EDUCATION');

    expect(education?.declared.toString()).toBe('10000');
    expect(education?.limit?.toString()).toBe('2400');
    expect(education?.allowed.toString()).toBe('2400');
    expect(education?.disallowed.toString()).toBe('7600');
    expect(r.totalDeductions.toString()).toBe('52400');
  });

  it('leaves a claim inside the ceiling exactly as declared', () => {
    // Two children, 5,000 of hostel allowance. The ceiling is 300 a month per
    // child: 300 x 12 x 2 = 7,200, which the claim is well inside, so nothing
    // is trimmed.
    const r = calculateIncomeTax(
      d(1200000),
      oldRegimeWithSection10,
      { ...noDeclarations, hostelAllowance: d(5000), childrenCount: 2 },
      d(0),
    );

    const hostel = r.section10Exemptions.find((e) => e.head === 'HOSTEL_ALLOWANCE');

    expect(hostel?.limit?.toString()).toBe('7200');
    expect(hostel?.allowed.toString()).toBe('5000');
    expect(hostel?.disallowed.toString()).toBe('0');
    expect(r.totalDeductions.toString()).toBe('55000');
  });

  it('allows nothing under either 10(14) head when no child is declared', () => {
    // The ceiling is per child, so with no children it is nil. An allowance
    // claimed for nobody exempts nothing.
    const r = calculateIncomeTax(
      d(1200000),
      oldRegimeWithSection10,
      {
        ...noDeclarations,
        childrenEducationAllowance: d(2400),
        hostelAllowance: d(7200),
        childrenCount: 0,
      },
      d(0),
    );

    expect(r.totalDeductions.toString()).toBe('50000');
    for (const head of ['CHILDREN_EDUCATION', 'HOSTEL_ALLOWANCE']) {
      const entry = r.section10Exemptions.find((e) => e.head === head);
      expect(entry?.limit?.toString()).toBe('0');
      expect(entry?.allowed.toString()).toBe('0');
    }
  });

  it('takes the ceilings from the year configuration, not from the code', () => {
    // A year that doubled the monthly figures must double the exemption
    // without anyone editing the calculation.
    const doubled = {
      ...oldRegimeWithLimits,
      section10Limits: {
        childrenEducationMonthlyLimit: d(200),
        hostelAllowanceMonthlyLimit: d(600),
        maxChildren: 2,
      },
    };

    const r = calculateIncomeTax(
      d(1200000),
      doubled,
      {
        ...noDeclarations,
        childrenEducationAllowance: d(99999),
        hostelAllowance: d(99999),
        childrenCount: 2,
      },
      d(0),
    );

    // 200 x 12 x 2 = 4,800 and 600 x 12 x 2 = 14,400.
    expect(
      r.section10Exemptions.find((e) => e.head === 'CHILDREN_EDUCATION')?.allowed.toString(),
    ).toBe('4800');
    expect(
      r.section10Exemptions.find((e) => e.head === 'HOSTEL_ALLOWANCE')?.allowed.toString(),
    ).toBe('14400');
  });

  it('allows leave travel at the declared figure, with no ceiling of its own', () => {
    // Section 10(5) limits the concession to what was actually spent on
    // travel. That is the figure the employee declares and a proof settles;
    // there is no monetary maximum in the Act to apply here.
    const r = calculateIncomeTax(
      d(1200000),
      oldRegimeWithSection10,
      { ...noDeclarations, ltaExemption: d(45000) },
      d(0),
    );

    const lta = r.section10Exemptions.find((e) => e.head === 'LTA');

    expect(lta?.declared.toString()).toBe('45000');
    expect(lta?.limit).toBeNull();
    expect(lta?.allowed.toString()).toBe('45000');
    expect(r.totalDeductions.toString()).toBe('95000');
  });

  it('adds the exempt allowances to house rent for the section 10 total', () => {
    // HRA 1,20,000 + LTA 45,000 + education 1,200 (of 5,000, one child) +
    // hostel 7,200 (of 9,000, two children) = 1,73,400. That is line 2 of
    // Form 16.
    const r = calculateIncomeTax(
      d(1200000),
      oldRegimeWithSection10,
      {
        ...noDeclarations,
        hraExemption: d(120000),
        ltaExemption: d(45000),
        childrenEducationAllowance: d(5000),
        hostelAllowance: d(9000),
        childrenCount: 2,
      },
      d(0),
    );

    // Education: 100 x 12 x 2 = 2,400 allowed of the 5,000 declared.
    // Hostel: 300 x 12 x 2 = 7,200 allowed of the 9,000 declared.
    // 1,20,000 + 45,000 + 2,400 + 7,200 = 1,74,600.
    expect(r.totalSection10Exemption.toString()).toBe('174600');
    expect(r.section10Exemptions.map((e) => e.head)).toEqual([
      'HRA',
      'LTA',
      'CHILDREN_EDUCATION',
      'HOSTEL_ALLOWANCE',
    ]);
    // 50,000 standard + 1,74,600 exempt
    expect(r.totalDeductions.toString()).toBe('224600');
  });

  it('exempts none of them under the new regime, as it exempts no house rent', () => {
    // Section 115BAC withdraws all four. The employee is taxed on 12,00,000
    // less the 75,000 standard deduction whatever they declared.
    const r = calculateIncomeTax(
      d(1200000),
      { ...newRegime, section10Limits },
      {
        ...noDeclarations,
        hraExemption: d(120000),
        ltaExemption: d(45000),
        childrenEducationAllowance: d(5000),
        hostelAllowance: d(9000),
        childrenCount: 2,
      },
      d(0),
    );

    expect(r.section10Exemptions).toEqual([]);
    expect(r.totalSection10Exemption.toString()).toBe('0');
    expect(r.taxableIncome.toString()).toBe('1125000');
  });

  it('taxes an employee who declares none of them exactly as before', () => {
    // The regression that matters: nobody's tax may move because the three new
    // heads exist. 10,00,000 old regime with 1,50,000 of 80C is the chapter
    // VI-A case above, and it must still come to 75,400.
    const r = calculateIncomeTax(
      d(1000000),
      oldRegimeWithSection10,
      { ...noDeclarations, section80C: d(150000) },
      d(0),
    );

    expect(r.taxableIncome.toString()).toBe('800000');
    expect(r.totalTax.toString()).toBe('75400');
    expect(r.totalSection10Exemption.toString()).toBe('0');
  });

  it('falls back to the statutory ceilings when the year supplies none', () => {
    // A caller not yet passing the year's row still gets the cap, because
    // capping is the correct behaviour and 100 / 300 / two children are both
    // the section and the schema's defaults.
    const r = calculateIncomeTax(
      d(1200000),
      oldRegimeWithLimits,
      { ...noDeclarations, childrenEducationAllowance: d(5000), childrenCount: 1 },
      d(0),
    );

    expect(r.totalDeductions.toString()).toBe('51200');
  });
});
