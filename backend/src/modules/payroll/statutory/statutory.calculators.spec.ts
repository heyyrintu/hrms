import { Decimal } from '@prisma/client/runtime/library';
import {
  calculatePf,
  calculateEsi,
  calculateProfessionalTax,
  calculateLwf,
  calculateIncomeTax,
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
