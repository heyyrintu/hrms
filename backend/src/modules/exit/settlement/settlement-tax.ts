import { Decimal } from '@prisma/client/runtime/library';
import { TaxAgeBand } from '@prisma/client';
import {
  calculateIncomeTax,
  IncomeTaxConfigInput,
  IncomeTaxResult,
  TaxDeclarationInput,
} from '../../payroll/statutory/statutory.calculators';
import type { DeductionLimits } from '../../payroll/statutory/tax-correctness.types';
import { capTaxAtPayable } from '../../payroll/statutory/completion.types';
import {
  calculateSection89Relief,
  Section89GratuityWorking,
  Section89YearBasis,
  Section89YearWorking,
} from './section-89-relief';

/**
 * Tax on a full and final settlement.
 *
 * A settlement is the last payment of a financial year that is already part
 * spent: the leaver has been paid for the months worked and has had tax
 * deducted against a projection of what the whole year would come to. That
 * projection is now wrong — the year ends at the exit, and it ends with a
 * lump that no monthly instalment anticipated. What remains owing is the
 * year's whole liability, worked out on what the employee has actually
 * received, less what has actually been deducted.
 *
 * So the shape of the calculation is not "tax on the settlement". It is:
 *
 *     annual income   = what the payslips already show
 *                     + the taxable parts of this settlement
 *     annual tax      = the year's tax on that income, after the declaration
 *     deduct now      = annual tax - tax already deducted this year
 *
 * The parts of the settlement that reach here are the **taxable balances**.
 * Gratuity exempt under section 10(10) and leave encashment exempt under
 * section 10(10AA) are worked out before this is called — both are stored on
 * the settlement as their own columns — and only what is left of each is
 * income. Passing the gross figures instead would tax money the Act exempts.
 *
 * Nothing here reads a database or a clock: the year's configuration, the
 * employee's declaration and the year-to-date totals all arrive as arguments,
 * which is what makes the figures below checkable by hand.
 *
 * The tax itself is `calculateIncomeTax` from the payroll module. There is one
 * income tax engine in this codebase and this is not a second one: slabs,
 * rebate, surcharge, marginal relief, cess and the chapter VI-A ceilings are
 * all its business, and this only decides what income and which deductions to
 * hand it.
 *
 * Four things the year's liability alone would get wrong are handled on top of
 * it, each of them visible in the working afterwards:
 *
 *  - **Relief under section 89**, where the settlement bunches several years
 *    of leave encashment into one. Computed in `section-89-relief.ts` and
 *    subtracted from the year's tax; nil with a stated reason where it cannot
 *    be worked out, which includes the two cases that gate it — no Form 10E
 *    furnished, and gratuity, which rule 21A(3) takes out of this method
 *    altogether.
 *  - **The tax is capped at what the settlement actually pays.** See
 *    `capTaxAtPayable` in the shared contract for why, and `uncollectedTax` in
 *    the working for what was left uncollected when it bit.
 *  - **Approved proofs**, where the tenant requires them and the exit month
 *    has reached the cutoff. The caller does the replacing, exactly as the
 *    monthly engine does; what reaches here is the declaration after it, and
 *    both sets of figures are recorded.
 *  - **An exit month paid twice is reported, not corrected.** Where a payroll
 *    run has already covered the month of exit and the settlement also pays
 *    pro-rata salary for it, both are paid, so both are taxed, and the overlap
 *    is recorded in the working with both figures named and flagged for a
 *    person. Netting one off would leave money paid and untaxed, which is
 *    worse than the duplication it hides; and a duplicated *payment* is not
 *    something a tax calculation may quietly fix.
 *
 * NOT IMPLEMENTED, and material in real cases:
 *
 *  - **Each earlier year's own total income**, for the section 89 spread.
 *    Nothing records what a leaver earned before this system ran their
 *    payroll, so the year of receipt's income stands in for it. See
 *    `section-89-relief.ts` for which way that errs — and for why that
 *    stand-in will not do for the average-rate method rule 21A(3) prescribes
 *    for gratuity, which is therefore refused rather than approximated.
 *  - **Perquisites and section 10 exemptions** other than the two the
 *    settlement itself computes are not derived; anything of that kind has to
 *    reach the year's income through the declaration or a payslip.
 *
 * This is not a substitute for review by a qualified payroll professional.
 */

/** The reason recorded when the year has no seeded slabs to tax against. */
export const NO_TAX_CONFIGURATION = 'NO_INCOME_TAX_CONFIGURATION';

/** The reason recorded when the tenant has switched TDS off altogether. */
export const TDS_DISABLED = 'TDS_DISABLED_FOR_TENANT';

const ZERO = new Decimal(0);

/** Round to paise, half up, which is the convention the settlement uses. */
function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** A stored Decimal column, or nothing at all, as a Decimal. */
function amount(value: Decimal | string | number | null | undefined): Decimal {
  return value === null || value === undefined ? ZERO : new Decimal(value);
}

/** The taxable balance of each thing the settlement pays. */
export interface SettlementTaxableParts {
  /** Salary for the part-month worked. Taxable in full. */
  proRataSalary: Decimal;
  /** Gratuity less the part exempt under section 10(10). */
  gratuityTaxable: Decimal;
  /** Leave encashment less the part exempt under section 10(10AA). */
  leaveEncashmentTaxable: Decimal;
  /** Bonus, ex gratia, reimbursement: taxable as entered. */
  otherEarnings: Decimal;
}

/** What the employee's payslips for this financial year already add up to. */
export interface SettlementYearToDate {
  grossPaid: Decimal;
  tdsDeducted: Decimal;
  professionalTaxPaid: Decimal;
  /** How many payslips those totals came from, for the working. */
  payslips: number;
  /**
   * The part of those totals that belongs to the month of exit.
   *
   * Identified by the payroll run's own year and month, not by a count: a
   * count alone says only that some payslip exists, where what matters is
   * that a run covering the month of exit does. Both are carried so that the
   * overlap can be named in the working rather than merely detected.
   *
   * Where such a run exists and the settlement also pays pro-rata salary for
   * the same month, both amounts are taxed and the overlap is flagged. It is
   * not netted off: see `SettlementExitMonthWorking`.
   */
  exitMonthPayslips?: {
    count: number;
    grossPaid: Decimal;
    /** The run's own year and month, as the payslip read selected them. */
    year: number;
    month: number;
  } | null;
}

/**
 * What the settlement pays before any tax comes off it.
 *
 * Gross payable less the recoveries, which is the money the employer actually
 * has in hand to deduct from. It may be nil or negative: notice recovery can
 * legitimately swallow a settlement whole.
 */
export type SettlementPayableBeforeTax = Decimal;

/** The years a bunched amount is spread back over, and their slabs. */
export interface SettlementSection89Input {
  /**
   * How many years of service the gratuity and leave encashment were earned
   * over. Zero or absent means it is not known, and relief is refused with
   * that as the reason rather than guessed at.
   */
  yearsEarnedOver: number;
  receiptYear: Section89YearBasis;
  spreadYears: Section89YearBasis[];
}

/**
 * Whether approved proofs replaced the declared figures, and both sets.
 *
 * The replacing is the caller's, because it needs the database; this records
 * what was done so the leaver can be shown why their exemption shrank.
 */
export interface SettlementProofsApplied {
  applied: boolean;
  cutoffMonth: number | null;
  verified: Record<string, string> | null;
  declared: Record<string, string> | null;
}

export interface SettlementTaxInput {
  /** The Indian financial year the last working day falls in, as its opening year. */
  financialYear: number;
  regime: 'OLD' | 'NEW';
  /**
   * The year's slabs and rates, or null when the tenant has seeded none for
   * this year, regime and band. Null is not an error: it is the one case where
   * no defensible figure exists, and it produces an explained zero.
   */
  config: IncomeTaxConfigInput | null;
  /** The employee's declaration, or all zeroes where none was made. */
  declaration: TaxDeclarationInput;
  /** Whether a declaration was actually found, as against defaulted to zero. */
  declarationFound: boolean;
  /**
   * Whether the employee furnished Form 10E for this year.
   *
   * Section 192(2A) lets the employer compute relief under section 89 only on
   * the particulars furnished in that form, so without it relief is refused
   * with that as the reason. Required rather than defaulted, because the
   * defect this closes was relief granted on an assumption nobody made.
   */
  form10EFurnished: boolean;
  /** The band whose slabs `config` holds. */
  ageBandUsed: TaxAgeBand;
  /** The band the employee's age asked for, before any fallback. */
  ageBandRequested: TaxAgeBand;
  /** True when the requested band had no row and GENERAL was used instead. */
  ageBandFallback: boolean;
  parts: SettlementTaxableParts;
  yearToDate: SettlementYearToDate;
  /**
   * Gross payable less recoveries: the ceiling on what can be deducted. The
   * employer cannot take tax out of a payment that does not exist.
   */
  payableBeforeTax: SettlementPayableBeforeTax;
  /** Absent means nothing is known about the years, and relief is refused. */
  section89?: SettlementSection89Input;
  /** Absent means verification was not in force for this exit. */
  proofs?: SettlementProofsApplied;
  /**
   * Why no configuration was even looked for, when that is the case. Absent
   * with a null `config` means the year simply has no seeded row.
   */
  unavailable?: { reason: string; note: string };
}

/**
 * An exit-month payslip standing alongside a settlement pro-rata for the same
 * month: both figures, named, and flagged for a person to look at.
 *
 * Nothing is netted off. If both amounts are genuinely paid then both are
 * income and both are taxed; if one of them should not have been paid, the
 * mistake is in **what is paid**, and the tax calculation is not the place to
 * correct it quietly. A processor who sees this can fix the payment. Nobody
 * can fix a number that silently vanished.
 */
export interface SettlementExitMonthWorking {
  /** The year and month of the payroll run that overlaps. */
  year: number;
  month: number;
  payslipsAlreadyRun: number;
  /** What that run paid, already inside the year-to-date gross. */
  payslipGross: string;
  /** What this settlement pays for the same month. Taxed, not excluded. */
  settlementProRata: string;
  /** Always true when this block is present: a person has to look at it. */
  requiresReview: true;
  note: string;
}

/** The section 89 relief and its working, flattened for storage. */
export interface SettlementSection89Working {
  relief: string;
  taxWithArrears: string;
  taxWithoutArrears: string;
  taxIfSpread: string;
  ineligibleReason: string | null;
  /** The bunched amount: the taxable balances of gratuity and encashment. */
  arrears: string;
  /** The part of it relief was actually computed on, under rule 21A(2). */
  relievableArrears: string;
  /** What rule 21A(3) allowed on the gratuity inside `arrears`, and why. */
  gratuity: Section89GratuityWorking;
  /** Whether the employee furnished Form 10E. Nothing is relieved without it. */
  form10EFurnished: boolean;
  /** The year's income with the relievable part taken back out of it. */
  incomeWithoutArrears: string;
  yearsEarnedOver: number;
  years: Section89YearWorking[];
  costOfBunching: string;
  reliefBeforeFloor: string;
  yearsWithoutConfiguration: number[];
  note: string;
}

/**
 * How the figure was arrived at, in the shape the payslip's `taxComputation`
 * uses: fixed-point strings, plain objects, nothing that needs a Decimal to
 * read back. Somebody asked why ₹87,000 was deducted answers from this.
 */
export interface SettlementTaxWorking {
  financialYear: number;
  /** False when no tax could be worked out; `reason` then says why. */
  computed: boolean;
  reason: string | null;
  regime: 'OLD' | 'NEW';
  ageBand: TaxAgeBand;
  ageBandRequested: TaxAgeBand;
  ageBandFallbackApplied: boolean;
  declarationFound: boolean;
  settlementTaxable: {
    /** What the settlement pays as pro-rata salary. Always taxed in full. */
    proRataSalary: string;
    gratuityTaxable: string;
    leaveEncashmentTaxable: string;
    otherEarnings: string;
    /** What went into the year's income: the sum of the four above. */
    total: string;
  };
  yearToDate: {
    grossPaid: string;
    tdsDeducted: string;
    professionalTaxPaid: string;
    payslips: number;
  };
  /**
   * An exit-month payroll run overlapping this settlement's pro-rata salary,
   * where there is one. Nothing is left out of the income on account of it:
   * it is recorded and flagged for review.
   */
  exitMonth: SettlementExitMonthWorking | null;
  /** Whether approved proofs stood in for the declaration, and both sets. */
  proofs: SettlementProofsApplied;
  previousEmployerTds: string;
  projectedAnnualGross: string;
  taxableIncome: string | null;
  totalDeductions: string | null;
  taxBeforeRebate: string | null;
  rebate: string | null;
  surcharge: string | null;
  surchargeBeforeRelief: string | null;
  marginalRelief: string | null;
  reliefThreshold: string | null;
  cess: string | null;
  /** The year's tax before relief under section 89. */
  annualTaxBeforeRelief: string | null;
  /** The relief, and the whole of its working. */
  section89: SettlementSection89Working;
  /** The year's tax after that relief. Never negative. */
  annualTax: string | null;
  alreadyDeducted: string;
  /** What the settlement pays before tax: the ceiling on what can be deducted. */
  payableBeforeTax: string;
  /** The balance of the year's tax, before that ceiling was applied. */
  taxBeforeCap: string;
  /**
   * The part of it the settlement could not cover. Not written off: it is the
   * leaver's own liability when they file, and nobody learns that from a
   * number that silently shrank.
   */
  uncollectedTax: string;
  /** The figure this computation produced, before any human override. */
  computedTds: string;
  deductionLimits: Record<string, string> | null;
  chapterVIACaps: Record<
    string,
    { declared: string; limit: string; allowed: string; disallowed: string }
  >;
  note: string;
}

export interface SettlementTaxResult {
  /** What to deduct. Never negative: a settlement does not refund tax. */
  tds: Decimal;
  working: SettlementTaxWorking;
}

/**
 * A stored declaration row in the shape the calculator wants.
 *
 * `null` means the employee never filed one, which is not the same as filing
 * an empty one but is treated the same way here: nothing is claimed, so
 * nothing is deducted. The difference is recorded in the working, because
 * "you claimed nothing" and "we have nothing from you" are different
 * conversations to have with a leaver.
 */
export function toTaxDeclarationInput(
  row: {
    section80C?: Decimal | string | number | null;
    section80D?: Decimal | string | number | null;
    section80CCD1B?: Decimal | string | number | null;
    section80CCD2?: Decimal | string | number | null;
    hraExemption?: Decimal | string | number | null;
    ltaExemption?: Decimal | string | number | null;
    childrenEducationAllowance?: Decimal | string | number | null;
    hostelAllowance?: Decimal | string | number | null;
    childrenCount?: number | null;
    homeLoanInterest?: Decimal | string | number | null;
    otherDeductions?: Decimal | string | number | null;
    otherIncome?: Decimal | string | number | null;
    previousEmployerTds?: Decimal | string | number | null;
  } | null,
): TaxDeclarationInput {
  return {
    section80C: amount(row?.section80C),
    section80D: amount(row?.section80D),
    section80CCD1B: amount(row?.section80CCD1B),
    section80CCD2: amount(row?.section80CCD2),
    hraExemption: amount(row?.hraExemption),
    // The section 10 heads are carried through for the same reason as the rest:
    // a leaver is entitled to the declaration their monthly payroll was
    // computed against, and dropping these would tax them on income the
    // payslips of the same year already treated as exempt.
    ltaExemption: amount(row?.ltaExemption),
    childrenEducationAllowance: amount(row?.childrenEducationAllowance),
    hostelAllowance: amount(row?.hostelAllowance),
    childrenCount: row?.childrenCount ?? 0,
    homeLoanInterest: amount(row?.homeLoanInterest),
    otherDeductions: amount(row?.otherDeductions),
    otherIncome: amount(row?.otherIncome),
    previousEmployerTds: amount(row?.previousEmployerTds),
  };
}

/**
 * A tenant's `IncomeTaxConfig` row in the shape the calculator wants.
 *
 * The ceilings on sections 80C, 80D and 80CCD(1B) are carried through rather
 * than applied here; the calculator caps against them, and it is the one place
 * that rule lives.
 */
export function toIncomeTaxConfigInput(
  row: {
    standardDeduction: Decimal | string | number;
    rebateIncomeLimit: Decimal | string | number;
    rebateMaxAmount: Decimal | string | number;
    cessRate: Decimal | string | number;
    surchargeSlabs: unknown;
    section80CLimit?: Decimal | string | number | null;
    section80DLimit?: Decimal | string | number | null;
    section80CCD1BLimit?: Decimal | string | number | null;
    childrenEducationMonthlyLimit?: Decimal | string | number | null;
    hostelAllowanceMonthlyLimit?: Decimal | string | number | null;
    childrenAllowanceMaxChildren?: number | null;
    marginalReliefEnabled?: boolean | null;
    slabs: {
      fromAmount: Decimal | string | number;
      toAmount: Decimal | string | number | null;
      rate: Decimal | string | number;
    }[];
  },
  regime: 'OLD' | 'NEW',
  ageBand: TaxAgeBand,
): IncomeTaxConfigInput {
  const limits: DeductionLimits = {
    section80C: amount(row.section80CLimit ?? 150000),
    section80D: amount(row.section80DLimit ?? 25000),
    section80CCD1B: amount(row.section80CCD1BLimit ?? 50000),
  };

  return {
    regime,
    standardDeduction: new Decimal(row.standardDeduction),
    rebateIncomeLimit: new Decimal(row.rebateIncomeLimit),
    rebateMaxAmount: new Decimal(row.rebateMaxAmount),
    cessRate: new Decimal(row.cessRate),
    surchargeSlabs:
      (row.surchargeSlabs as { threshold: number; rate: number }[] | null) ?? [],
    slabs: row.slabs.map((slab) => ({
      fromAmount: new Decimal(slab.fromAmount),
      toAmount: slab.toAmount === null ? null : new Decimal(slab.toAmount),
      rate: new Decimal(slab.rate),
    })),
    ageBand,
    limits,
    // The year's section 10(14) ceilings, per child per month, and the most
    // children they may be claimed for. Carried through rather than applied
    // here, as the chapter VI-A ceilings are: the calculator caps, so there is
    // one place the rule lives. The fallbacks are the statutory figures and
    // the schema's own defaults.
    section10Limits: {
      childrenEducationMonthlyLimit: amount(row.childrenEducationMonthlyLimit ?? 100),
      hostelAllowanceMonthlyLimit: amount(row.hostelAllowanceMonthlyLimit ?? 300),
      maxChildren: row.childrenAllowanceMaxChildren ?? 2,
    },
    marginalReliefEnabled: row.marginalReliefEnabled ?? true,
  };
}

/** The sentence appended to the working when no declaration was found. */
const NO_DECLARATION_NOTE =
  'The employee filed no tax declaration for this year, so no deduction, ' +
  'exemption or previous-employer tax was claimed and the whole income has ' +
  'been taxed. Anything they were entitled to comes back on assessment.';

/**
 * What tax to deduct from a settlement, and the working behind it.
 *
 * The result is a **default**, not a decision: whoever processes the exit can
 * override it, and their circumstances may include something this cannot see —
 * relief under section 89, income the employee never declared, a rent receipt
 * that arrived on the last day. What this guarantees is that the default is
 * defensible and that the arithmetic behind it survives.
 */
export function computeSettlementTax(input: SettlementTaxInput): SettlementTaxResult {
  const { parts, yearToDate, declaration } = input;

  // A payroll run covering the month of exit, alongside a settlement that
  // also pays pro-rata salary for the same month. Both are taxed: the
  // settlement pays that pro-rata, and money that is paid is income. What is
  // recorded here is the overlap itself, named on both sides, for a person to
  // resolve.
  const exitMonthPayslips = yearToDate.exitMonthPayslips ?? null;
  const overlapsExitMonth = Boolean(
    exitMonthPayslips && exitMonthPayslips.count > 0 && parts.proRataSalary.gt(0),
  );

  const exitMonth: SettlementExitMonthWorking | null =
    overlapsExitMonth && exitMonthPayslips
      ? {
          year: exitMonthPayslips.year,
          month: exitMonthPayslips.month,
          payslipsAlreadyRun: exitMonthPayslips.count,
          payslipGross: money(exitMonthPayslips.grossPaid).toFixed(2),
          settlementProRata: money(parts.proRataSalary).toFixed(2),
          requiresReview: true,
          note:
            'NEEDS REVIEW: payroll has already run the month of exit — ' +
            `${exitMonthPayslips.count} payslip(s) for ` +
            `${String(exitMonthPayslips.month).padStart(2, '0')}/` +
            `${exitMonthPayslips.year} totalling ` +
            `${money(exitMonthPayslips.grossPaid).toFixed(2)} gross, already in the ` +
            'year to date above — and this settlement pays a further ' +
            `${money(parts.proRataSalary).toFixed(2)} of pro-rata salary for that same ` +
            'month. Both amounts are being paid, so both have been taxed: tax follows ' +
            'what is paid, and quietly dropping one would leave money paid and ' +
            'untaxed. If the month has in fact been paid twice, the duplicate is in ' +
            'the payment — in this settlement or in that payroll run — and is to be ' +
            'corrected there, not in the tax. Somebody should check which of the two ' +
            'figures is right before this settlement is paid.',
        }
      : null;

  const settlementTaxable = money(
    parts.proRataSalary
      .add(parts.gratuityTaxable)
      .add(parts.leaveEncashmentTaxable)
      .add(parts.otherEarnings),
  );
  const annualGross = money(yearToDate.grossPaid.add(settlementTaxable));

  // The bunched part of the settlement: gratuity and leave encashment are
  // earned across the years of service, where pro-rata salary and other
  // earnings belong to this year alone.
  const arrears = money(parts.gratuityTaxable.add(parts.leaveEncashmentTaxable));
  const relief = calculateSection89Relief({
    totalIncomeWithArrears: annualGross,
    totalIncomeWithoutArrears: money(annualGross.sub(arrears)),
    arrears,
    yearsEarnedOver: input.section89?.yearsEarnedOver ?? 0,
    receiptYear: input.section89?.receiptYear ?? {
      financialYear: input.financialYear,
      config: input.config,
    },
    spreadYears: input.section89?.spreadYears ?? [],
    declaration,
    professionalTaxPaid: yearToDate.professionalTaxPaid,
    form10EFurnished: input.form10EFurnished,
    // Rule 21A(3) measures the gratuity against the length of past service,
    // which for a settlement is the completed years the bunched amount was
    // earned over. Absent, nothing is known about it and nothing is assumed.
    gratuity: {
      taxable: parts.gratuityTaxable,
      serviceYears: input.section89?.yearsEarnedOver ?? 0,
    },
  });

  const section89: SettlementSection89Working = {
    relief: relief.relief.toFixed(2),
    taxWithArrears: relief.taxWithArrears.toFixed(2),
    taxWithoutArrears: relief.taxWithoutArrears.toFixed(2),
    taxIfSpread: relief.taxIfSpread.toFixed(2),
    ineligibleReason: relief.ineligibleReason,
    arrears: arrears.toFixed(2),
    relievableArrears: relief.working.relievableArrears,
    gratuity: relief.working.gratuity,
    form10EFurnished: input.form10EFurnished,
    incomeWithoutArrears: money(
      annualGross.sub(new Decimal(relief.working.relievableArrears)),
    ).toFixed(2),
    yearsEarnedOver: relief.working.yearsEarnedOver,
    years: relief.working.years,
    costOfBunching: relief.working.costOfBunching,
    reliefBeforeFloor: relief.working.reliefBeforeFloor,
    yearsWithoutConfiguration: relief.working.yearsWithoutConfiguration,
    note: relief.working.note,
  };

  const proofs: SettlementProofsApplied = input.proofs ?? {
    applied: false,
    cutoffMonth: null,
    verified: null,
    declared: null,
  };

  // Tax already collected this year, by us and by any previous employer. Both
  // count against the same annual liability.
  const alreadyDeducted = money(
    yearToDate.tdsDeducted.add(declaration.previousEmployerTds),
  );

  const base = {
    financialYear: input.financialYear,
    regime: input.regime,
    ageBand: input.ageBandUsed,
    ageBandRequested: input.ageBandRequested,
    ageBandFallbackApplied: input.ageBandFallback,
    declarationFound: input.declarationFound,
    settlementTaxable: {
      proRataSalary: parts.proRataSalary.toFixed(2),
      gratuityTaxable: parts.gratuityTaxable.toFixed(2),
      leaveEncashmentTaxable: parts.leaveEncashmentTaxable.toFixed(2),
      otherEarnings: parts.otherEarnings.toFixed(2),
      total: settlementTaxable.toFixed(2),
    },
    yearToDate: {
      grossPaid: yearToDate.grossPaid.toFixed(2),
      tdsDeducted: yearToDate.tdsDeducted.toFixed(2),
      professionalTaxPaid: yearToDate.professionalTaxPaid.toFixed(2),
      payslips: yearToDate.payslips,
    },
    exitMonth,
    proofs,
    section89,
    previousEmployerTds: declaration.previousEmployerTds.toFixed(2),
    projectedAnnualGross: annualGross.toFixed(2),
    alreadyDeducted: alreadyDeducted.toFixed(2),
    payableBeforeTax: money(input.payableBeforeTax).toFixed(2),
  };

  // No slabs for this year, regime and band. There is nothing defensible to
  // deduct, so nothing is deducted — but deliberately, and the working says so.
  // Zero tax on a large settlement is a conspicuous number and whoever is
  // asked about it is owed the reason rather than a shrug.
  if (!input.config) {
    return {
      tds: ZERO,
      working: {
        ...base,
        computed: false,
        reason: input.unavailable?.reason ?? NO_TAX_CONFIGURATION,
        taxableIncome: null,
        totalDeductions: null,
        taxBeforeRebate: null,
        rebate: null,
        surcharge: null,
        surchargeBeforeRelief: null,
        marginalRelief: null,
        reliefThreshold: null,
        cess: null,
        annualTaxBeforeRelief: null,
        annualTax: null,
        taxBeforeCap: '0.00',
        uncollectedTax: '0.00',
        computedTds: '0.00',
        deductionLimits: null,
        chapterVIACaps: {},
        note:
          (input.unavailable?.note ??
            `There is no income tax configuration for FY ${input.financialYear}-` +
              `${String((input.financialYear + 1) % 100).padStart(2, '0')} under the ` +
              `${input.regime} regime, so no tax could be worked out and none has been ` +
              "deducted. This is not a finding that no tax is due: seed the year's " +
              'slabs and recompute, or enter the figure as an override.') +
          (input.declarationFound ? '' : ` ${NO_DECLARATION_NOTE}`),
      },
    };
  }

  const computed: IncomeTaxResult = calculateIncomeTax(
    annualGross,
    input.config,
    declaration,
    // Section 16(iii) allows the professional tax actually paid, and the
    // employee is not going to pay any more of it this year. Under the new
    // regime the calculator ignores this.
    yearToDate.professionalTaxPaid,
  );

  // Relief under section 89 reduces the year's liability, not the settlement's
  // taxable income: the arrears are taxed, and the extra tax the bunching
  // caused is then given back. Floored at zero, as the year's tax cannot be
  // negative however large the relief.
  const annualTaxBeforeRelief = computed.totalTax;
  const annualTax = Decimal.max(annualTaxBeforeRelief.sub(relief.relief), ZERO);

  // The whole balance, not an instalment: there are no months left to spread it
  // over. Floored at zero — where too much has already been deducted the excess
  // comes back on assessment, and a settlement does not refund tax.
  const taxBeforeCap = money(Decimal.max(annualTax.sub(alreadyDeducted), ZERO));

  // And no more than the settlement actually pays. See `capTaxAtPayable`.
  const capped = capTaxAtPayable(taxBeforeCap, input.payableBeforeTax);
  const tds = money(capped.deducted);
  const uncollected = money(capped.uncollected);

  const chapterVIACaps = Object.fromEntries(
    computed.chapterVIACaps.map((cap) => [
      cap.section,
      {
        declared: cap.declared.toFixed(2),
        limit: cap.limit.toFixed(2),
        allowed: cap.allowed.toFixed(2),
        disallowed: cap.disallowed.toFixed(2),
      },
    ]),
  );

  const limits = input.config.limits;

  return {
    tds,
    working: {
      ...base,
      computed: true,
      reason: null,
      taxableIncome: computed.taxableIncome.toFixed(2),
      totalDeductions: computed.totalDeductions.toFixed(2),
      taxBeforeRebate: computed.taxBeforeRebate.toFixed(2),
      rebate: computed.rebate.toFixed(2),
      surcharge: computed.surcharge.toFixed(2),
      surchargeBeforeRelief: computed.surchargeBeforeRelief.toFixed(2),
      marginalRelief: computed.marginalRelief.toFixed(2),
      reliefThreshold: computed.reliefThreshold
        ? computed.reliefThreshold.toFixed(2)
        : null,
      cess: computed.cess.toFixed(2),
      annualTaxBeforeRelief: money(annualTaxBeforeRelief).toFixed(2),
      annualTax: money(annualTax).toFixed(2),
      taxBeforeCap: taxBeforeCap.toFixed(2),
      uncollectedTax: uncollected.toFixed(2),
      computedTds: tds.toFixed(2),
      deductionLimits: limits
        ? {
            section80C: limits.section80C.toFixed(2),
            section80D: limits.section80D.toFixed(2),
            section80CCD1B: limits.section80CCD1B.toFixed(2),
          }
        : null,
      chapterVIACaps,
      note:
        'The year\'s tax on everything the employee has been paid this year ' +
        'plus the taxable parts of this settlement, less the tax already ' +
        'deducted. The exempt parts of gratuity and leave encashment are not ' +
        'in the income above.' +
        (relief.relief.gt(0)
          ? ` Relief of ${relief.relief.toFixed(2)} under section 89 has been ` +
            'allowed on the leave encashment bunched into this year; see the ' +
            'section 89 working for how it was reached and what it excluded.'
          : ` No relief under section 89 has been allowed: ${relief.working.note}`) +
        (exitMonth ? ` ${exitMonth.note}` : '') +
        (proofs.applied
          ? ' The figures allowed under every proof-backed head are what the ' +
            'employee\'s approved proofs prove, not what they declared: this ' +
            'tenant requires proof and the month of exit is at or past the ' +
            'cutoff. A head with no approved proof allowed nothing.'
          : '') +
        (uncollected.gt(0)
          ? ` The year's tax leaves ${taxBeforeCap.toFixed(2)} still to collect, but ` +
            `this settlement only pays ${money(input.payableBeforeTax).toFixed(2)} ` +
            `before tax, so ${tds.toFixed(2)} has been deducted and ` +
            `${uncollected.toFixed(2)} could not be. That balance is not written ` +
            'off: it is the employee\'s own liability when they file their return.'
          : '') +
        (input.declarationFound ? '' : ` ${NO_DECLARATION_NOTE}`),
    },
  };
}
