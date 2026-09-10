/**
 * Types for Indian statutory payroll: return files, Form 16 Part B, gratuity
 * and full and final settlement.
 *
 * Every money figure arrives as a `string`. The backend holds them as Prisma
 * `Decimal`, which serializes to a decimal string rather than a JavaScript
 * number, and that is deliberate: a rupee figure that has been through a float
 * is no longer the figure that was computed. Format them for display and send
 * them back untouched; do not parse one into a `number` and then store it.
 */

// ---------------------------------------------------------------------------
// Return and challan files
// ---------------------------------------------------------------------------

/** The five statutory files a completed payroll run can produce. */
export enum StatutoryReturnKind {
  PF_ECR = 'pf-ecr',
  ESI = 'esi',
  PROFESSIONAL_TAX = 'professional-tax',
  FORM_24Q = 'form-24q',
  BANK_TRANSFER = 'bank-transfer',
}

export interface GeneratedReturnFile {
  filename: string;
  contentType: string;
  content: string;
  /**
   * Employees deliberately left out of the file, and why. Never hide this: an
   * employee missing from a return is a filing defect, not a detail.
   */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Form 16 Part B
// ---------------------------------------------------------------------------

export type TaxRegimeName = 'OLD' | 'NEW';

export interface Form16Employer {
  name: string;
  address: string;
  tan: string | null;
  pan: string | null;
}

export interface Form16Employee {
  id: string;
  name: string;
  employeeCode: string;
  pan: string | null;
  designation: string | null;
}

export interface Form16Section16 {
  standardDeduction: string;
  /** Section 16(iii): professional tax actually paid. Old regime only. */
  professionalTax: string;
  total: string;
}

export interface Form16ChapterVIA {
  section80C: string;
  section80D: string;
  section80CCD1B: string;
  /** The employer's NPS contribution, allowed under both regimes. */
  section80CCD2: string;
  otherDeductions: string;
  total: string;
}

export interface Form16Quarter {
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  months: string[];
  amountPaid: string;
  taxDeducted: string;
  payslipCount: number;
  /**
   * Always null. TRACES issues the receipt number against a filed Form 24Q and
   * it cannot be known here. Render the absence rather than hiding the column.
   */
  tracesReceiptNumber: null;
}

export interface QuarterlyTdsSummary {
  financialYear: number;
  financialYearLabel: string;
  employee: Form16Employee;
  quarters: Form16Quarter[];
  totalAmountPaid: string;
  totalTaxDeducted: string;
  notes: string[];
}

/**
 * Part B of Form 16, with the numbered lines the statutory form uses.
 *
 * There is no Part A here and there will not be. TRACES issues it against the
 * returns actually filed; anything generated locally that looked like Part A
 * would be a forgery. Say so wherever this is displayed.
 */
export interface Form16PartB {
  financialYear: number;
  financialYearLabel: string;
  assessmentYear: string;
  /** ISO dates for the certificate period, clamped to the employment dates. */
  periodFrom: string;
  periodTo: string;
  regime: TaxRegimeName;
  employer: Form16Employer;
  employee: Form16Employee;

  /** False when the employee had no payslip in the year; every figure is nil. */
  hasPayslipsInYear: boolean;
  payslipCount: number;

  /** 1. Gross salary. */
  grossSalary: string;
  /** 2. Less: allowances exempt under section 10. */
  allowancesExemptSection10: string;
  /** 3. Balance. */
  balance: string;
  /** 4. Deductions under section 16. */
  deductionsSection16: Form16Section16;
  /** 5. Income chargeable under the head "Salaries". */
  incomeChargeableUnderSalaries: string;
  /** 6a. Income under any other head offered for TDS. */
  otherIncome: string;
  /** 6b. Income from house property, negative when interest is claimed. */
  incomeFromHouseProperty: string;
  /** 7. Gross total income. */
  grossTotalIncome: string;
  /** 8. Deductions under Chapter VI-A. */
  deductionsChapterVIA: Form16ChapterVIA;
  /** 9. Total income. */
  totalIncome: string;
  /** 10. Tax on total income. */
  taxOnTotalIncome: string;
  /** 11. Rebate under section 87A. */
  rebateSection87A: string;
  /** 12. Surcharge, where applicable. */
  surcharge: string;
  /** 13. Health and education cess. */
  healthAndEducationCess: string;
  /** 14. Total tax payable. */
  totalTaxPayable: string;
  /** 15a. Tax deducted at source by this employer. */
  taxDeductedByEmployer: string;
  /** 15b. Tax reported as deducted by a previous employer. */
  taxDeductedByPreviousEmployer: string;
  /** 15. Total tax deducted. */
  totalTaxDeducted: string;

  balanceTaxPayable: string;
  refundDue: string;

  /** Informational: the employee's own PF, which often qualifies under 80C. */
  providentFundEmployeeContribution: string;

  quarterlyTds: Form16Quarter[];
  /**
   * Caveats the service attached to this certificate, including the standing
   * note that Part A comes from TRACES. Always render them.
   */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Full and final settlement
// ---------------------------------------------------------------------------

export enum SettlementStatus {
  DRAFT = 'DRAFT',
  APPROVED = 'APPROVED',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
}

/** The gratuity working, as the settlement recorded it. */
export interface SettlementGratuityBreakdown {
  eligible: boolean;
  ineligibleReason: string | null;
  /** Calendar years of service, unrounded. */
  serviceYears: string;
  /** Years counted by the formula, part-years over six months rounded up. */
  countedYears: string;
  amount: string;
  /** The part exempt under section 10(10). */
  exemptAmount: string;
  taxableAmount: string;
}

export interface SettlementBreakdown {
  computedAt: string;
  lastDrawnWages: string;
  monthlyGross: string;
  proRata: {
    monthlyGross: string;
    daysWorked: number;
    daysInMonth: number;
    amount: string;
    note: string;
  };
  leaveEncashment: {
    enabled: boolean;
    basis: string;
    perDayRate: string;
    totalDays: string;
    amount: string;
    leaveTypes: { name: string; days: string }[];
    note: string;
  };
  gratuity: SettlementGratuityBreakdown;
  noticeRecovery: {
    waived: boolean;
    required: number;
    served: number;
    shortfallDays: number;
    dailyRate: string;
    amount: string;
    note: string;
  };
  totals: Record<string, string>;
}

export interface Settlement {
  id: string;
  tenantId: string;
  separationId: string;
  employeeId: string;
  status: SettlementStatus;
  lastWorkingDate: string;

  proRataSalary: string;
  leaveEncashmentDays: string;
  leaveEncashment: string;
  gratuity: string;
  gratuityExempt: string;
  otherEarnings: string;

  noticeShortfallDays: number;
  noticeRecovery: string;
  otherRecoveries: string;
  /** Supplied by whoever processes the exit, not computed from the year. */
  tds: string;

  grossPayable: string;
  totalRecoveries: string;
  netPayable: string;

  breakdown: SettlementBreakdown | null;
  remarks: string | null;

  approvedBy: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;

  employee?: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    email: string;
    designation?: { name: string } | string | null;
    department?: { name: string } | null;
    joinDate?: string;
  };
  separation?: {
    id: string;
    type: string;
    status: string;
    initiatedDate: string;
    lastWorkingDate?: string;
    noticePeriodDays: number;
    isNoticePeriodWaived?: boolean;
  };
}

/** The four figures a settlement cannot derive and a human must enter. */
export interface UpdateSettlementPayload {
  otherEarnings?: number;
  otherRecoveries?: number;
  tds?: number;
  remarks?: string;
}

// Tenant configuration and the employee tax declaration. Re-exported through
// this module rather than the barrel so the two stay together.
export * from './statutory-config';

// Investment proofs: evidence behind a declared deduction, and its review.
export * from './proofs';
