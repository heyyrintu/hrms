import { Decimal } from '@prisma/client/runtime/library';
import { TaxAgeBand } from '@prisma/client';
import {
  DeductionLimits,
  SurchargeResult,
  collectsProfessionalTaxIn,
} from './tax-correctness.types';

/**
 * Pure calculations for the Indian statutory payroll deductions.
 *
 * Everything here is a function of its arguments: no database, no clock, no
 * configuration read from the environment. Rates and slabs arrive as
 * parameters because they change most years and several vary by state, and the
 * caller loads them from the tenant's configuration rows.
 *
 * Money is Decimal throughout. Each statute rounds differently and the rules
 * are followed here rather than approximated: EPFO rounds contributions to the
 * nearest rupee, ESIC rounds each share up to the next rupee.
 *
 * These implement the common cases of the relevant Acts. They are not a
 * substitute for review by a qualified payroll professional, and several
 * refinements are deliberately absent; see the notes on each function.
 */

/** Round to the nearest rupee, half away from zero. Used for EPF and tax. */
function toRupees(value: Decimal): Decimal {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/** Round up to the next whole rupee, as ESIC requires for both shares. */
function toRupeesUp(value: Decimal): Decimal {
  return value.toDecimalPlaces(0, Decimal.ROUND_UP);
}

function percentOf(base: Decimal, ratePercent: Decimal): Decimal {
  return base.mul(ratePercent).div(100);
}

// ---------------------------------------------------------------------------
// Employees' Provident Fund
// ---------------------------------------------------------------------------

export interface PfConfig {
  pfEnabled: boolean;
  pfEmployeeRate: Decimal;
  pfEmployerRate: Decimal;
  epsRate: Decimal;
  pfWageCeiling: Decimal;
  applyPfCeiling: boolean;
  edliRate: Decimal;
  pfAdminRate: Decimal;
}

export interface PfResult {
  /** The wage the contribution was actually computed on. */
  pfWages: Decimal;
  employee: Decimal;
  /** The employer's provident fund share, after the pension share is carved out. */
  employerPf: Decimal;
  /** Employees' Pension Scheme, taken out of the employer's 12%, not added to it. */
  eps: Decimal;
  edli: Decimal;
  admin: Decimal;
}

const ZERO_PF: PfResult = {
  pfWages: new Decimal(0),
  employee: new Decimal(0),
  employerPf: new Decimal(0),
  eps: new Decimal(0),
  edli: new Decimal(0),
  admin: new Decimal(0),
};

/**
 * EPF for one employee for one month.
 *
 * `pfWages` is basic plus dearness allowance, not gross. The pension share is
 * always computed on wages capped at the statutory ceiling even when the
 * employer has chosen to contribute on full wages, because that cap is
 * statutory rather than a matter of employer policy.
 *
 * Administration charges are returned per employee at the plain percentage.
 * The establishment-level monthly minimum is not applied here, because it is a
 * property of the establishment rather than of any one employee; apply it when
 * preparing the ECR.
 */
export function calculatePf(
  pfWages: Decimal,
  config: PfConfig,
  employeeIsExcluded: boolean,
): PfResult {
  if (!config.pfEnabled || employeeIsExcluded || pfWages.lte(0)) {
    return { ...ZERO_PF };
  }

  const contributionWages = config.applyPfCeiling
    ? Decimal.min(pfWages, config.pfWageCeiling)
    : pfWages;

  // The pension share is capped by statute regardless of employer policy.
  const pensionWages = Decimal.min(pfWages, config.pfWageCeiling);

  const employee = toRupees(percentOf(contributionWages, config.pfEmployeeRate));
  const eps = toRupees(percentOf(pensionWages, config.epsRate));
  const employerTotal = toRupees(percentOf(contributionWages, config.pfEmployerRate));

  // EPS comes out of the employer's share. If a configured rate ever made EPS
  // the larger of the two, the provident fund share floors at zero rather than
  // going negative.
  const employerPf = Decimal.max(employerTotal.sub(eps), new Decimal(0));

  return {
    pfWages: contributionWages,
    employee,
    employerPf,
    eps,
    edli: toRupees(percentOf(pensionWages, config.edliRate)),
    admin: toRupees(percentOf(contributionWages, config.pfAdminRate)),
  };
}

// ---------------------------------------------------------------------------
// Employees' State Insurance
// ---------------------------------------------------------------------------

export interface EsiConfig {
  esiEnabled: boolean;
  esiEmployeeRate: Decimal;
  esiEmployerRate: Decimal;
  esiWageLimit: Decimal;
}

export interface EsiResult {
  covered: boolean;
  esiWages: Decimal;
  employee: Decimal;
  employer: Decimal;
}

/**
 * ESI for one employee for one month, computed on gross wages.
 *
 * `continuedFromPeriod` carries the rule that crossing the wage limit
 * mid-period does not end coverage: an employee who was covered at the start
 * of a contribution period (April to September, or October to March) keeps
 * contributing until that period ends. The caller decides this by looking at
 * earlier payslips in the period; the calculation itself stays pure.
 */
export function calculateEsi(
  grossWages: Decimal,
  config: EsiConfig,
  continuedFromPeriod: boolean,
): EsiResult {
  const withinLimit = grossWages.lte(config.esiWageLimit);
  const covered = config.esiEnabled && (withinLimit || continuedFromPeriod);

  if (!covered || grossWages.lte(0)) {
    return {
      covered: false,
      esiWages: new Decimal(0),
      employee: new Decimal(0),
      employer: new Decimal(0),
    };
  }

  return {
    covered: true,
    esiWages: grossWages,
    employee: toRupeesUp(percentOf(grossWages, config.esiEmployeeRate)),
    employer: toRupeesUp(percentOf(grossWages, config.esiEmployerRate)),
  };
}

// ---------------------------------------------------------------------------
// Professional tax
// ---------------------------------------------------------------------------

export interface PtSlab {
  fromAmount: Decimal;
  toAmount: Decimal | null;
  amount: Decimal;
  februaryAmount: Decimal | null;
  gender: string | null;
}

/**
 * Professional tax for one month.
 *
 * A state levy, so the slabs are data rather than code. Three wrinkles are
 * modelled because they are common: Maharashtra charges a different figure in
 * February, some states set a higher exemption threshold for women, and
 * several — Tamil Nadu among them — collect half-yearly rather than monthly.
 *
 * A slab amount is the figure for one collection, so a half-yearly state's
 * amount must be taken in its collection months and not in the other ten;
 * deducting it every month would take six times what the state levies.
 * `ptMonths` says which calendar months those are, and an empty list means
 * every month, which is what most states do and what this did before the
 * column existed.
 */
export function calculateProfessionalTax(
  monthlyGross: Decimal,
  slabs: PtSlab[],
  month: number,
  gender: string | null,
  ptMonths: number[] | null | undefined = [],
): Decimal {
  if (!collectsProfessionalTaxIn(month, ptMonths)) return new Decimal(0);

  const slab = slabs.find(
    (s) =>
      (s.gender === null || s.gender === gender) &&
      monthlyGross.gte(s.fromAmount) &&
      (s.toAmount === null || monthlyGross.lte(s.toAmount)),
  );

  if (!slab) return new Decimal(0);

  if (month === 2 && slab.februaryAmount !== null) {
    return slab.februaryAmount;
  }
  return slab.amount;
}

// ---------------------------------------------------------------------------
// Labour Welfare Fund
// ---------------------------------------------------------------------------

export interface LwfConfig {
  lwfEnabled: boolean;
  lwfEmployeeAmount: Decimal;
  lwfEmployerAmount: Decimal;
  /** Calendar months in which the state collects; most are not monthly. */
  lwfMonths: number[];
}

export function calculateLwf(
  config: LwfConfig,
  month: number,
): { employee: Decimal; employer: Decimal } {
  if (!config.lwfEnabled || !config.lwfMonths.includes(month)) {
    return { employee: new Decimal(0), employer: new Decimal(0) };
  }
  return {
    employee: config.lwfEmployeeAmount,
    employer: config.lwfEmployerAmount,
  };
}

// ---------------------------------------------------------------------------
// Income tax (TDS under section 192)
// ---------------------------------------------------------------------------

export interface IncomeTaxSlabRow {
  fromAmount: Decimal;
  toAmount: Decimal | null;
  rate: Decimal;
}

export interface SurchargeSlab {
  threshold: number;
  rate: number;
}

export interface IncomeTaxConfigInput {
  regime: 'OLD' | 'NEW';
  standardDeduction: Decimal;
  rebateIncomeLimit: Decimal;
  rebateMaxAmount: Decimal;
  cessRate: Decimal;
  surchargeSlabs: SurchargeSlab[];
  slabs: IncomeTaxSlabRow[];
  /**
   * Which basic-exemption band `slabs` were seeded for. The old regime exempts
   * more for a senior and more again for a super senior, and the caller picks
   * the row by band before it gets here, so this is carried only so the working
   * can say which band was used. Absent means GENERAL, the band an employee
   * with no recorded date of birth is treated as.
   */
  ageBand?: TaxAgeBand;
  /**
   * The year's chapter VI-A ceilings. A figure above one of these does not
   * reduce tax whatever its provenance, so the calculation caps rather than
   * trusting what was entered or what a reviewer approved.
   *
   * Absent falls back to the statutory maxima below, which are also the
   * schema's defaults: capping is the correct behaviour, so a caller that has
   * not been updated to pass the year's row still gets it.
   */
  limits?: DeductionLimits;
  /**
   * Whether marginal relief applies to surcharge. Absent means it does, which
   * is how the Act has read for years; the flag exists so a year that worked
   * differently can still be seeded.
   */
  marginalReliefEnabled?: boolean;
  /**
   * The year's section 10(14) ceilings. Absent falls back to the statutory
   * figures below, which are also the schema's defaults, for the same reason
   * `limits` does: capping is the correct behaviour, so a caller that has not
   * been updated to pass the year's row still gets it.
   */
  section10Limits?: Section10AllowanceLimits;
}

/**
 * The section 10(14) ceilings for the year.
 *
 * Both allowances are set per child, per month, for a limited number of
 * children, so all three numbers are needed to work out a year's ceiling and
 * none of them belongs in the code: the Finance Act moves them and the schema
 * holds them per year.
 */
export interface Section10AllowanceLimits {
  /** Children's education allowance, per child per month. The rule says ₹100. */
  childrenEducationMonthlyLimit: Decimal;
  /** Hostel allowance, per child per month. The rule says ₹300. */
  hostelAllowanceMonthlyLimit: Decimal;
  /** The most children either allowance may be claimed for. The rule says two. */
  maxChildren: number;
}

/** Used when a caller has not supplied the year's row. See `limits` above. */
const STATUTORY_DEDUCTION_LIMITS: DeductionLimits = {
  section80C: new Decimal(150000),
  section80D: new Decimal(25000),
  section80CCD1B: new Decimal(50000),
};

/** Used when a caller has not supplied the year's row. See `section10Limits`. */
const STATUTORY_SECTION_10_LIMITS: Section10AllowanceLimits = {
  childrenEducationMonthlyLimit: new Decimal(100),
  hostelAllowanceMonthlyLimit: new Decimal(300),
  maxChildren: 2,
};

const MONTHS_IN_YEAR = new Decimal(12);

export interface TaxDeclarationInput {
  section80C: Decimal;
  section80D: Decimal;
  section80CCD1B: Decimal;
  /** Employer NPS contribution, allowed under both regimes. */
  section80CCD2: Decimal;
  hraExemption: Decimal;
  /**
   * Section 10(5): leave travel concession.
   *
   * The section limits the exemption to what was actually spent on travel, and
   * that figure is what the employee declares and what a proof settles. There
   * is no monetary ceiling in the Act to apply here, so this is taken as
   * supplied — as home loan interest is.
   *
   * Optional so that a caller written before the three section 10 heads
   * existed still type-checks and still computes exactly what it did.
   */
  ltaExemption?: Decimal;
  /** Section 10(14): children's education allowance, before the per-child cap. */
  childrenEducationAllowance?: Decimal;
  /** Section 10(14): hostel allowance, before the per-child cap. */
  hostelAllowance?: Decimal;
  /**
   * How many children the two section 10(14) allowances are claimed for.
   * Capped at the year's maximum by the calculation, so a declaration of six
   * children does not widen the ceiling.
   */
  childrenCount?: number;
  homeLoanInterest: Decimal;
  otherDeductions: Decimal;
  otherIncome: Decimal;
  previousEmployerTds: Decimal;
}

/**
 * One chapter VI-A head, as declared and as allowed.
 *
 * Kept as a pair rather than a single capped figure because an employee whose
 * 80C claim was trimmed is owed the reason, and "you declared 2,00,000, the
 * section allows 1,50,000" is the reason.
 */
export interface DeductionCapEntry {
  section: '80C' | '80D' | '80CCD(1B)';
  /** What arrived, whether declared by the employee or proved and approved. */
  declared: Decimal;
  /** The statutory ceiling for the year. */
  limit: Decimal;
  /** The lesser of the two: what actually came off the income. */
  allowed: Decimal;
  /** The remainder, which reduces no tax. Zero when the claim was within the limit. */
  disallowed: Decimal;
}

/**
 * One section 10 exemption head, as declared and as allowed.
 *
 * The same pair as `DeductionCapEntry`, and for the same reason: an employee
 * whose ₹5,000 of school fees exempted ₹1,200 is owed the arithmetic, and
 * "₹100 a month, one child, twelve months" is the arithmetic. A capped figure
 * that arrives on its own looks like a mistake.
 */
export interface Section10ExemptionEntry {
  head: 'HRA' | 'LTA' | 'CHILDREN_EDUCATION' | 'HOSTEL_ALLOWANCE';
  /** What arrived, whether declared by the employee or proved and approved. */
  declared: Decimal;
  /**
   * The year's ceiling for this head, or null where the section sets no
   * monetary ceiling of its own. House rent is worked out from rent and salary
   * before it reaches here, and leave travel is limited to what was spent, so
   * both are null rather than nought.
   */
  limit: Decimal | null;
  /** What actually came off the salary. */
  allowed: Decimal;
  /** The remainder, which exempts nothing. Zero when the claim was within the ceiling. */
  disallowed: Decimal;
}

export interface IncomeTaxResult {
  grossTotalIncome: Decimal;
  totalDeductions: Decimal;
  taxableIncome: Decimal;
  taxBeforeRebate: Decimal;
  rebate: Decimal;
  /** Surcharge actually charged, after any marginal relief. */
  surcharge: Decimal;
  /** What the flat slab rate would have produced, for the working. */
  surchargeBeforeRelief: Decimal;
  /** The reduction. Zero when no threshold was crossed or relief did not bite. */
  marginalRelief: Decimal;
  /** The threshold relief was measured against, or null when none was. */
  reliefThreshold: Decimal | null;
  cess: Decimal;
  /** Liability for the whole financial year, after rebate, surcharge and cess. */
  totalTax: Decimal;
  /** Which band's slabs were applied. GENERAL under the new regime. */
  ageBand: TaxAgeBand;
  /**
   * The chapter VI-A heads that have a statutory ceiling, declared against
   * allowed. Empty under the new regime, where none of them is available.
   */
  chapterVIACaps: DeductionCapEntry[];
  /**
   * The section 10 exemptions, declared against allowed. Empty under the new
   * regime, which withdraws all of them.
   *
   * These reduce salary rather than total income, so they belong on Form 16's
   * line 2 and not among the chapter VI-A deductions on line 8.
   */
  section10Exemptions: Section10ExemptionEntry[];
  /** The sum of what those exemptions allowed: Form 16's line 2. */
  totalSection10Exemption: Decimal;
}

/** Tax on an amount, walking the slabs and taxing only the band in each. */
function taxFromSlabs(taxableIncome: Decimal, slabs: IncomeTaxSlabRow[]): Decimal {
  let tax = new Decimal(0);

  for (const slab of slabs) {
    if (taxableIncome.lte(slab.fromAmount)) break;

    const upper = slab.toAmount === null ? taxableIncome : Decimal.min(taxableIncome, slab.toAmount);
    const band = upper.sub(slab.fromAmount);
    if (band.gt(0)) {
      tax = tax.add(percentOf(band, slab.rate));
    }
  }

  return tax;
}

/**
 * The surcharge band an income falls in, or undefined below every threshold.
 *
 * Strictly above, never at: somebody sitting exactly on a threshold has not
 * crossed it and pays the band below.
 */
function surchargeSlabFor(
  income: Decimal,
  surchargeSlabs: SurchargeSlab[],
): SurchargeSlab | undefined {
  return [...surchargeSlabs]
    .sort((a, b) => a.threshold - b.threshold)
    .filter((s) => income.gt(s.threshold))
    .pop();
}

/** Slab tax, then the section 87A rebate, which cannot exceed the tax due. */
function taxAfterRebateOn(
  income: Decimal,
  config: IncomeTaxConfigInput,
): { taxBeforeRebate: Decimal; rebate: Decimal; taxAfterRebate: Decimal } {
  const taxBeforeRebate = toRupees(taxFromSlabs(income, config.slabs));

  const rebate = income.lte(config.rebateIncomeLimit)
    ? Decimal.min(taxBeforeRebate, config.rebateMaxAmount)
    : new Decimal(0);

  return {
    taxBeforeRebate,
    rebate,
    taxAfterRebate: Decimal.max(taxBeforeRebate.sub(rebate), new Decimal(0)),
  };
}

/**
 * Tax plus surcharge, no cess, at an income. Used for the threshold end of the
 * marginal relief comparison.
 *
 * The surcharge here is the flat one. At a threshold exactly, the band that
 * applies is the one below, and relief at *that* lower threshold stopped biting
 * long before — the gap between two thresholds is fifty lakh or more, and
 * relief runs out within a couple of lakh — so there is nothing to unwind.
 */
function taxPlusSurchargeAt(income: Decimal, config: IncomeTaxConfigInput): Decimal {
  const { taxAfterRebate } = taxAfterRebateOn(income, config);

  const band = surchargeSlabFor(income, config.surchargeSlabs);
  const surcharge = band
    ? toRupees(percentOf(taxAfterRebate, new Decimal(band.rate)))
    : new Decimal(0);

  return taxAfterRebate.add(surcharge);
}

/**
 * Surcharge on the year's tax, with marginal relief.
 *
 * Surcharge starts at a threshold and is charged on the whole of the tax, not
 * on the part above, so a rupee of income over a threshold can carry a lakh of
 * surcharge with it. Marginal relief caps the extra tax-plus-surcharge at the
 * extra income: whoever earns one rupee more than the threshold pays one rupee
 * more, not one lakh more.
 *
 * The comparison is made against the highest threshold the income actually
 * crossed, and the liability at that threshold includes the surcharge of the
 * band below it, so relief at the second and third thresholds is measured from
 * the right place rather than from zero.
 */
export function calculateSurcharge(
  taxableIncome: Decimal,
  taxAfterRebate: Decimal,
  config: IncomeTaxConfigInput,
): SurchargeResult {
  const zero = new Decimal(0);

  const applicable = surchargeSlabFor(taxableIncome, config.surchargeSlabs);
  if (!applicable) {
    return {
      surcharge: zero,
      surchargeBeforeRelief: zero,
      marginalRelief: zero,
      reliefThreshold: null,
    };
  }

  const surchargeBeforeRelief = toRupees(
    percentOf(taxAfterRebate, new Decimal(applicable.rate)),
  );

  // Absent means enabled. A year that levied surcharge without relief can say
  // so, and then this behaves as the flat rate it always did.
  if (config.marginalReliefEnabled === false) {
    return {
      surcharge: surchargeBeforeRelief,
      surchargeBeforeRelief,
      marginalRelief: zero,
      reliefThreshold: null,
    };
  }

  const threshold = new Decimal(applicable.threshold);
  const liabilityCap = taxPlusSurchargeAt(threshold, config).add(
    taxableIncome.sub(threshold),
  );

  // Relief only ever gives back surcharge; it never reaches into the tax.
  const marginalRelief = Decimal.min(
    Decimal.max(taxAfterRebate.add(surchargeBeforeRelief).sub(liabilityCap), zero),
    surchargeBeforeRelief,
  );

  return {
    surcharge: surchargeBeforeRelief.sub(marginalRelief),
    surchargeBeforeRelief,
    marginalRelief,
    reliefThreshold: threshold,
  };
}

/**
 * Cap one chapter VI-A head at its statutory ceiling.
 *
 * The cap applies whatever the figure's provenance. A reviewer who approved
 * evidence for ₹2,00,000 under section 80C confirmed the investment; they did
 * not raise the limit, and neither does anybody else upstream of here.
 */
function capDeduction(
  section: DeductionCapEntry['section'],
  declared: Decimal,
  limit: Decimal,
): DeductionCapEntry {
  const allowed = Decimal.min(declared, limit);
  return {
    section,
    declared,
    limit,
    allowed,
    disallowed: declared.sub(allowed),
  };
}

/**
 * The section 10 exemptions available under the old regime, declared against
 * allowed.
 *
 * Exported because Form 16's line 2 is these four heads and nothing else, and
 * the certificate must not add them up its own way. One place computes them.
 *
 * The two section 10(14) allowances are ceilinged per child, per month, for a
 * limited number of children, so the year's ceiling is
 * `monthly x 12 x min(children, maximum)`. The cap is applied here, in the
 * calculation, and not wherever the figure was collected — for the same reason
 * the chapter VI-A ceilings are: a reviewer who accepts a school fee receipt
 * for ₹5,000 has confirmed the fee, not raised the statutory limit.
 *
 * Nothing here is available under the new regime. Section 115BAC withdraws all
 * four, so the list is empty and an old-regime declaration reduces no tax at
 * all — exactly as `hraExemption` has always behaved.
 */
export function calculateSection10Exemptions(
  declarations: TaxDeclarationInput,
  isOldRegime: boolean,
  limits: Section10AllowanceLimits = STATUTORY_SECTION_10_LIMITS,
): Section10ExemptionEntry[] {
  if (!isOldRegime) return [];

  const zero = new Decimal(0);

  // A child declared beyond the maximum widens nothing. Nor does a negative
  // count, which the schema cannot hold but a caller could still pass.
  const eligibleChildren = new Decimal(
    Math.max(0, Math.min(declarations.childrenCount ?? 0, limits.maxChildren)),
  );

  const perChildYearlyLimit = (monthly: Decimal): Decimal =>
    monthly.mul(MONTHS_IN_YEAR).mul(eligibleChildren);

  const entry = (
    head: Section10ExemptionEntry['head'],
    declared: Decimal,
    limit: Decimal | null,
  ): Section10ExemptionEntry => {
    const allowed = limit === null ? declared : Decimal.min(declared, limit);
    return { head, declared, limit, allowed, disallowed: declared.sub(allowed) };
  };

  return [
    // House rent already arrives worked out against rent paid and salary, so
    // there is no further ceiling to apply to it here.
    entry('HRA', declarations.hraExemption, null),
    // Section 10(5) is limited to what was actually spent on travel, which is
    // the declared figure itself. The Act sets no rupee maximum.
    entry('LTA', declarations.ltaExemption ?? zero, null),
    entry(
      'CHILDREN_EDUCATION',
      declarations.childrenEducationAllowance ?? zero,
      perChildYearlyLimit(limits.childrenEducationMonthlyLimit),
    ),
    entry(
      'HOSTEL_ALLOWANCE',
      declarations.hostelAllowance ?? zero,
      perChildYearlyLimit(limits.hostelAllowanceMonthlyLimit),
    ),
  ];
}

/**
 * Annual income tax liability for one employee.
 *
 * The two regimes differ in what may be deducted. Under the new regime only
 * the standard deduction and the employer's NPS contribution under section
 * 80CCD(2) are available; chapter VI-A deductions, HRA exemption, home loan
 * interest and the professional tax deduction under section 16(iii) are not.
 *
 * Sections 80C, 80D and 80CCD(1B) are capped at the year's ceilings here, in
 * the calculation, rather than in whatever collected the figure. A declared
 * amount over the ceiling reduces no tax and neither does an approved one, so
 * the cap belongs where the tax is worked out and not in a form.
 *
 * The age-banded basic exemption is a matter of which configuration row was
 * loaded: senior and super-senior slabs are seeded separately and the caller
 * picks by band. Nothing here assumes a band; `config.ageBand` is carried into
 * the result so the working says which one was applied.
 *
 * The section 10 exemptions — house rent, leave travel, and the two 10(14)
 * allowances for children — reduce salary rather than total income, so they
 * come off before the chapter VI-A heads and belong on Form 16's line 2. The
 * two 10(14) allowances are ceilinged per child, per month, for at most the
 * year's maximum number of children; see `calculateSection10Exemptions`.
 *
 * Not implemented, and material for some employees:
 *  - section 10 exemptions beyond those four, such as the gratuity and leave
 *    encashment exemptions, which are settled on exit rather than in payroll;
 *  - deductions under heads with no ceiling of their own held here, such as
 *    home loan interest, which is taken as supplied.
 */
export function calculateIncomeTax(
  annualGrossSalary: Decimal,
  config: IncomeTaxConfigInput,
  declarations: TaxDeclarationInput,
  professionalTaxPaid: Decimal,
): IncomeTaxResult {
  const isOldRegime = config.regime === 'OLD';
  const limits = config.limits ?? STATUTORY_DEDUCTION_LIMITS;

  const grossTotalIncome = annualGrossSalary.add(declarations.otherIncome);

  // The employer's NPS contribution is deductible under both regimes.
  let deductions = config.standardDeduction.add(declarations.section80CCD2);

  // Empty under the new regime, where none of these heads is available at all.
  const chapterVIACaps: DeductionCapEntry[] = [];

  // Likewise empty under the new regime: section 115BAC withdraws all four.
  const section10Exemptions = calculateSection10Exemptions(
    declarations,
    isOldRegime,
    config.section10Limits ?? STATUTORY_SECTION_10_LIMITS,
  );
  const totalSection10Exemption = section10Exemptions.reduce(
    (sum, e) => sum.add(e.allowed),
    new Decimal(0),
  );

  if (isOldRegime) {
    chapterVIACaps.push(
      capDeduction('80C', declarations.section80C, limits.section80C),
      capDeduction('80D', declarations.section80D, limits.section80D),
      capDeduction('80CCD(1B)', declarations.section80CCD1B, limits.section80CCD1B),
    );

    for (const capped of chapterVIACaps) {
      deductions = deductions.add(capped.allowed);
    }

    deductions = deductions
      // House rent, leave travel and the two capped allowances for children,
      // at what the section allows rather than at what was claimed.
      .add(totalSection10Exemption)
      .add(declarations.homeLoanInterest)
      .add(declarations.otherDeductions)
      // Section 16(iii): professional tax actually paid. Not available under
      // the new regime.
      .add(professionalTaxPaid);
  }

  const taxableIncome = Decimal.max(grossTotalIncome.sub(deductions), new Decimal(0));

  const { taxBeforeRebate, rebate, taxAfterRebate } = taxAfterRebateOn(taxableIncome, config);

  // Surcharge is a percentage of the tax, decided by total income, and capped
  // by marginal relief where a threshold was only just crossed.
  const surchargeResult = calculateSurcharge(taxableIncome, taxAfterRebate, config);

  const cess = toRupees(
    percentOf(taxAfterRebate.add(surchargeResult.surcharge), config.cessRate),
  );
  const totalTax = taxAfterRebate.add(surchargeResult.surcharge).add(cess);

  return {
    grossTotalIncome,
    totalDeductions: deductions,
    taxableIncome,
    taxBeforeRebate,
    rebate,
    surcharge: surchargeResult.surcharge,
    surchargeBeforeRelief: surchargeResult.surchargeBeforeRelief,
    marginalRelief: surchargeResult.marginalRelief,
    reliefThreshold: surchargeResult.reliefThreshold,
    cess,
    totalTax,
    ageBand: config.ageBand ?? TaxAgeBand.GENERAL,
    chapterVIACaps,
    section10Exemptions,
    totalSection10Exemption,
  };
}

/**
 * How much of the annual liability to deduct this month.
 *
 * Section 192 requires the year's tax to be spread over the remaining months
 * rather than taken in a lump, so this is the balance still owing divided by
 * the months left, including the current one. Never negative: if too much has
 * already been deducted, the excess is settled when the employee files, not by
 * refunding through payroll.
 */
export function monthlyTdsInstalment(
  annualTax: Decimal,
  alreadyDeducted: Decimal,
  remainingMonths: number,
): Decimal {
  if (remainingMonths <= 0) return new Decimal(0);

  const outstanding = annualTax.sub(alreadyDeducted);
  if (outstanding.lte(0)) return new Decimal(0);

  return toRupees(outstanding.div(remainingMonths));
}
