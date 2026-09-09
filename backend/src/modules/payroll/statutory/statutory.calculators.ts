import { Decimal } from '@prisma/client/runtime/library';

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
 * A state levy, so the slabs are data rather than code. Two wrinkles are
 * modelled because they are common: Maharashtra charges a different figure in
 * February, and some states set a higher exemption threshold for women.
 *
 * States that levy half-yearly rather than monthly (Tamil Nadu, for one) are
 * not modelled; configure those as a monthly equivalent or leave the levy off.
 */
export function calculateProfessionalTax(
  monthlyGross: Decimal,
  slabs: PtSlab[],
  month: number,
  gender: string | null,
): Decimal {
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
}

export interface TaxDeclarationInput {
  section80C: Decimal;
  section80D: Decimal;
  section80CCD1B: Decimal;
  /** Employer NPS contribution, allowed under both regimes. */
  section80CCD2: Decimal;
  hraExemption: Decimal;
  homeLoanInterest: Decimal;
  otherDeductions: Decimal;
  otherIncome: Decimal;
  previousEmployerTds: Decimal;
}

export interface IncomeTaxResult {
  grossTotalIncome: Decimal;
  totalDeductions: Decimal;
  taxableIncome: Decimal;
  taxBeforeRebate: Decimal;
  rebate: Decimal;
  surcharge: Decimal;
  cess: Decimal;
  /** Liability for the whole financial year, after rebate, surcharge and cess. */
  totalTax: Decimal;
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
 * Annual income tax liability for one employee.
 *
 * The two regimes differ in what may be deducted. Under the new regime only
 * the standard deduction and the employer's NPS contribution under section
 * 80CCD(2) are available; chapter VI-A deductions, HRA exemption, home loan
 * interest and the professional tax deduction under section 16(iii) are not.
 *
 * Not implemented, and material for some employees:
 *  - marginal relief on surcharge, which caps the surcharge so that crossing a
 *    threshold cannot cost more than the income that crossed it;
 *  - the higher basic exemption for senior and very senior citizens under the
 *    old regime;
 *  - any limit checking on declared amounts. Section 80C is capped at
 *    1,50,000 by statute, but the figure is taken as declared, so validate it
 *    before it reaches here.
 */
export function calculateIncomeTax(
  annualGrossSalary: Decimal,
  config: IncomeTaxConfigInput,
  declarations: TaxDeclarationInput,
  professionalTaxPaid: Decimal,
): IncomeTaxResult {
  const isOldRegime = config.regime === 'OLD';

  const grossTotalIncome = annualGrossSalary.add(declarations.otherIncome);

  // The employer's NPS contribution is deductible under both regimes.
  let deductions = config.standardDeduction.add(declarations.section80CCD2);

  if (isOldRegime) {
    deductions = deductions
      .add(declarations.section80C)
      .add(declarations.section80D)
      .add(declarations.section80CCD1B)
      .add(declarations.hraExemption)
      .add(declarations.homeLoanInterest)
      .add(declarations.otherDeductions)
      // Section 16(iii): professional tax actually paid. Not available under
      // the new regime.
      .add(professionalTaxPaid);
  }

  const taxableIncome = Decimal.max(grossTotalIncome.sub(deductions), new Decimal(0));
  const taxBeforeRebate = toRupees(taxFromSlabs(taxableIncome, config.slabs));

  // Section 87A: a rebate, not an exemption, so it cannot exceed the tax due.
  const rebate = taxableIncome.lte(config.rebateIncomeLimit)
    ? Decimal.min(taxBeforeRebate, config.rebateMaxAmount)
    : new Decimal(0);

  const taxAfterRebate = Decimal.max(taxBeforeRebate.sub(rebate), new Decimal(0));

  // Surcharge is a percentage of the tax, decided by total income. Marginal
  // relief is not applied; see the note above.
  const applicable = [...config.surchargeSlabs]
    .sort((a, b) => a.threshold - b.threshold)
    .filter((s) => taxableIncome.gt(s.threshold))
    .pop();
  const surcharge = applicable
    ? toRupees(percentOf(taxAfterRebate, new Decimal(applicable.rate)))
    : new Decimal(0);

  const cess = toRupees(percentOf(taxAfterRebate.add(surcharge), config.cessRate));
  const totalTax = taxAfterRebate.add(surcharge).add(cess);

  return {
    grossTotalIncome,
    totalDeductions: deductions,
    taxableIncome,
    taxBeforeRebate,
    rebate,
    surcharge,
    cess,
    totalTax,
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
