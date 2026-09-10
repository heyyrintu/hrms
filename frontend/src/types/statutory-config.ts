/**
 * Types for the statutory payroll configuration and the employee tax
 * declaration.
 *
 * Rates, slabs and thresholds are data, not code: when a rate changes you edit
 * rows rather than source. These are the shapes those rows arrive in.
 *
 * Money and rates arrive as **strings**. The backend holds them as Prisma
 * `Decimal`, which serializes to a decimal string rather than a number, and a
 * rate that has been through a float is no longer the rate that was stored.
 * The update payloads take plain numbers, because that is what the DTO
 * validates, so the conversion happens only on the way out.
 */

import type { TaxRegimeName } from './statutory';

// ---------------------------------------------------------------------------
// Tenant configuration
// ---------------------------------------------------------------------------

/**
 * One row per tenant, holding which levies apply and at what rates.
 *
 * `null` from the API is meaningful and must not be rendered as zeros: with no
 * row, nothing statutory is deducted at all and payroll behaves as it did
 * before the feature existed. That is a state to be shown plainly, not a
 * missing record to be papered over.
 */
export interface StatutoryConfig {
  id: string;
  tenantId: string;

  // Employees Provident Funds Act 1952.
  pfEnabled: boolean;
  /** Employee share, percent of PF wages, which is basic plus dearness allowance. */
  pfEmployeeRate: string;
  /** Employer share, percent. The pension scheme is carved out of this, not added to it. */
  pfEmployerRate: string;
  /** Pension share, percent, always on wages capped at the ceiling. */
  epsRate: string;
  pfWageCeiling: string;
  /** Whether employee and employer shares are also capped. Many employers pay on full wages. */
  applyPfCeiling: boolean;
  edliRate: string;
  pfAdminRate: string;
  /** Monthly minimum for administration charges, a property of the establishment. */
  pfAdminMinimum: string;

  // Employees State Insurance Act 1948.
  esiEnabled: boolean;
  esiEmployeeRate: string;
  esiEmployerRate: string;
  /** Monthly gross at or below which an employee is covered. */
  esiWageLimit: string;

  // Professional tax, a state levy. Slabs live in their own table.
  ptEnabled: boolean;
  ptState: string | null;

  // Labour welfare fund, a state levy.
  lwfEnabled: boolean;
  lwfEmployeeAmount: string;
  lwfEmployerAmount: string;
  /** Calendar months, 1 to 12, in which the state collects. Most are not monthly. */
  lwfMonths: number[];

  // Payment of Gratuity Act 1972.
  gratuityEnabled: boolean;
  /** Days of wages per completed year. The Act says 15. */
  gratuityDaysPerYear: string;
  /** Days treated as a month's wages. The Act says 26 for covered establishments. */
  gratuityMonthDays: string;
  /** Completed years before any gratuity is payable. */
  gratuityMinYears: string;
  /** Section 10(10) ceiling. It caps the exempt part, never the amount payable. */
  gratuityExemptionCap: string;

  // Leave encashment on exit.
  leaveEncashmentEnabled: boolean;
  encashmentMonthDays: string;

  // Income Tax Act section 192.
  tdsEnabled: boolean;
  /** Applied to employees who have not chosen a regime themselves. */
  defaultTaxRegime: TaxRegimeName;

  createdAt: string;
  updatedAt: string;
}

/**
 * A patch. Only the fields supplied are changed.
 *
 * Numbers rather than strings, because the DTO validates numbers. A change
 * takes effect from the next payroll run; runs already computed are not
 * recalculated.
 */
export interface UpdateStatutoryConfigPayload {
  pfEnabled?: boolean;
  pfEmployeeRate?: number;
  pfEmployerRate?: number;
  epsRate?: number;
  pfWageCeiling?: number;
  applyPfCeiling?: boolean;
  edliRate?: number;
  pfAdminRate?: number;
  pfAdminMinimum?: number;

  esiEnabled?: boolean;
  esiEmployeeRate?: number;
  esiEmployerRate?: number;
  esiWageLimit?: number;

  ptEnabled?: boolean;
  ptState?: string;

  lwfEnabled?: boolean;
  lwfEmployeeAmount?: number;
  lwfEmployerAmount?: number;
  lwfMonths?: number[];

  gratuityEnabled?: boolean;
  gratuityDaysPerYear?: number;
  gratuityMonthDays?: number;
  gratuityMinYears?: number;
  gratuityExemptionCap?: number;

  leaveEncashmentEnabled?: boolean;
  encashmentMonthDays?: number;

  tdsEnabled?: boolean;
  defaultTaxRegime?: TaxRegimeName;
}

// ---------------------------------------------------------------------------
// Slab tables, which are read-only here
// ---------------------------------------------------------------------------

export interface ProfessionalTaxSlab {
  id: string;
  state: string;
  fromAmount: string;
  /** Null on the top slab, which has no upper bound. */
  toAmount: string | null;
  amount: string;
  /** Maharashtra charges a different figure in February. Null elsewhere. */
  februaryAmount: string | null;
  /** Some states set a higher exemption threshold for women. Null when it applies to all. */
  gender: string | null;
}

export interface IncomeTaxSlab {
  id: string;
  fromAmount: string;
  /** Null on the top slab. */
  toAmount: string | null;
  /** Percent. */
  rate: string;
}

export interface IncomeTaxConfig {
  id: string;
  /** FY 2026-27 is 2026. */
  financialYear: number;
  regime: TaxRegimeName;
  standardDeduction: string;
  /** Income at or below which the section 87A rebate applies. */
  rebateIncomeLimit: string;
  rebateMaxAmount: string;
  /** Health and education cess, percent. */
  cessRate: string;
  surchargeSlabs: unknown;
  slabs: IncomeTaxSlab[];
}

// ---------------------------------------------------------------------------
// Employee tax declaration
// ---------------------------------------------------------------------------

/**
 * What an employee declares for the year.
 *
 * These are declarations, not proofs. Nothing collects, verifies or approves
 * evidence, and no statutory ceiling is enforced on a declared amount, so the
 * resulting TDS is an estimate until proofs are checked out of band. Anywhere
 * these are shown or entered should say so.
 */
export interface EmployeeTaxDeclaration {
  id: string;
  tenantId: string;
  employeeId: string;
  financialYear: number;
  regime: TaxRegimeName;

  section80C: string;
  section80D: string;
  section80CCD1B: string;
  /** The employer's NPS contribution, allowed under both regimes. */
  section80CCD2: string;
  hraExemption: string;
  homeLoanInterest: string;
  otherDeductions: string;
  otherIncome: string;
  /** Tax already deducted by a previous employer this year. */
  previousEmployerTds: string;

  createdAt: string;
  updatedAt: string;
}

export interface UpsertTaxDeclarationPayload {
  /** FY 2026-27 is 2026. Defaults to the year in progress. */
  financialYear?: number;
  regime?: TaxRegimeName;
  section80C?: number;
  section80D?: number;
  section80CCD1B?: number;
  section80CCD2?: number;
  hraExemption?: number;
  homeLoanInterest?: number;
  otherDeductions?: number;
  otherIncome?: number;
  previousEmployerTds?: number;
}

/**
 * Which deductions the regime actually allows.
 *
 * Under the new regime only the standard deduction and the employer's NPS
 * contribution under section 80CCD(2) apply. Chapter VI-A deductions, the HRA
 * exemption, home loan interest and the professional tax deduction under
 * section 16(iii) do not. Entering them is not an error, but they will not
 * reduce the tax, and a form that accepts them silently misleads.
 */
export const ALLOWED_UNDER_NEW_REGIME: readonly (keyof UpsertTaxDeclarationPayload)[] = [
  'section80CCD2',
  'otherIncome',
  'previousEmployerTds',
  'financialYear',
  'regime',
];
