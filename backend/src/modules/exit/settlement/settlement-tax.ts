import { Decimal } from '@prisma/client/runtime/library';
import { TaxAgeBand } from '@prisma/client';
import {
  calculateIncomeTax,
  IncomeTaxConfigInput,
  IncomeTaxResult,
  TaxDeclarationInput,
} from '../../payroll/statutory/statutory.calculators';
import type { DeductionLimits } from '../../payroll/statutory/tax-correctness.types';

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
 * NOT IMPLEMENTED, and material in real cases:
 *
 *  - **Relief under section 89.** A settlement can bunch several years of
 *    gratuity and leave into one year's income and push the leaver into a
 *    higher slab. Relief may be available on Form 10E. It is not computed
 *    anywhere in this codebase, so the figure here can exceed what the
 *    employee finally owes; they recover the difference on assessment.
 *  - **Investment proofs are not consulted.** The monthly engine can be told
 *    to replace declared figures with proved ones from a cutoff month. A
 *    settlement takes the declaration as it stands, so a leaver whose proofs
 *    were never filed keeps the benefit of the declaration here and settles it
 *    on assessment.
 *  - **The final month's payslip is assumed not to exist yet.** Pro-rata
 *    salary for the part-month is treated as income not yet on any payslip.
 *    Where payroll has already run for the month of exit *and* the settlement
 *    also pays pro-rata salary, that month is counted twice and the tax is
 *    overstated. The working shows the payslip count and the year-to-date
 *    gross so this is visible rather than hidden.
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
  /** The band whose slabs `config` holds. */
  ageBandUsed: TaxAgeBand;
  /** The band the employee's age asked for, before any fallback. */
  ageBandRequested: TaxAgeBand;
  /** True when the requested band had no row and GENERAL was used instead. */
  ageBandFallback: boolean;
  parts: SettlementTaxableParts;
  yearToDate: SettlementYearToDate;
  /**
   * Why no configuration was even looked for, when that is the case. Absent
   * with a null `config` means the year simply has no seeded row.
   */
  unavailable?: { reason: string; note: string };
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
    proRataSalary: string;
    gratuityTaxable: string;
    leaveEncashmentTaxable: string;
    otherEarnings: string;
    total: string;
  };
  yearToDate: {
    grossPaid: string;
    tdsDeducted: string;
    professionalTaxPaid: string;
    payslips: number;
  };
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
  annualTax: string | null;
  alreadyDeducted: string;
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

  const settlementTaxable = money(
    parts.proRataSalary
      .add(parts.gratuityTaxable)
      .add(parts.leaveEncashmentTaxable)
      .add(parts.otherEarnings),
  );
  const annualGross = money(yearToDate.grossPaid.add(settlementTaxable));

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
    previousEmployerTds: declaration.previousEmployerTds.toFixed(2),
    projectedAnnualGross: annualGross.toFixed(2),
    alreadyDeducted: alreadyDeducted.toFixed(2),
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
        annualTax: null,
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

  // The whole balance, not an instalment: there are no months left to spread it
  // over. Floored at zero — where too much has already been deducted the excess
  // comes back on assessment, and a settlement does not refund tax.
  const tds = money(Decimal.max(computed.totalTax.sub(alreadyDeducted), ZERO));

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
      annualTax: computed.totalTax.toFixed(2),
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
        'in the income above.' + (input.declarationFound ? '' : ` ${NO_DECLARATION_NOTE}`),
    },
  };
}
