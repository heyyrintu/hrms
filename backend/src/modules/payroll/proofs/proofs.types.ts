import { InvestmentProofSection } from '@prisma/client';

/**
 * Shared contract between the proofs module and the TDS calculation.
 *
 * Declared separately from either so the two can be built against it at the
 * same time, and so both move together if the shape changes.
 */

/**
 * Which declaration field each proof head supports.
 *
 * The keys are the fields on `EmployeeTaxDeclaration` that evidence can back.
 * `section80CCD2` is absent deliberately: that is the employer's own NPS
 * contribution and the employer already knows it, so asking an employee to
 * prove it would be theatre. `otherIncome` is absent because declaring income
 * increases tax rather than reducing it, and nobody needs evidence to be taxed
 * more.
 *
 * The three section 10 heads are here because they are exactly the kind of
 * claim evidence settles: travel tickets, school fees, hostel bills.
 */
export const PROOF_SECTION_TO_DECLARATION_FIELD: Readonly<
  Record<InvestmentProofSection, ProofBackedField>
> = {
  SECTION_80C: 'section80C',
  SECTION_80D: 'section80D',
  SECTION_80CCD1B: 'section80CCD1B',
  HRA: 'hraExemption',
  HOME_LOAN_INTEREST: 'homeLoanInterest',
  OTHER_DEDUCTIONS: 'otherDeductions',
  PREVIOUS_EMPLOYER_TDS: 'previousEmployerTds',
  LTA: 'ltaExemption',
  CHILDREN_EDUCATION: 'childrenEducationAllowance',
  HOSTEL_ALLOWANCE: 'hostelAllowance',
};

/** A declaration field a proof can support. */
export type ProofBackedField =
  | 'section80C'
  | 'section80D'
  | 'section80CCD1B'
  | 'hraExemption'
  | 'homeLoanInterest'
  | 'otherDeductions'
  | 'previousEmployerTds'
  | 'ltaExemption'
  | 'childrenEducationAllowance'
  | 'hostelAllowance';

/**
 * The sum of approved proofs per declaration field, for one employee and year.
 *
 * A field absent from the map means no approved proof exists for it. That is
 * not the same as zero being proved, but for the tax calculation it has the
 * same effect once verification is in force, and the difference matters only in
 * what the employee is told.
 */
export type VerifiedTotals = Partial<Record<ProofBackedField, string>>;

/**
 * Whether verified amounts replace declared ones for a given payroll month.
 *
 * Two conditions, both of which must hold:
 *
 * 1. The tenant has opted in. Off by default, so an existing installation keeps
 *    taking declarations at face value exactly as it did before proofs existed.
 *    Switching this on mid-year raises the TDS of every employee who has not
 *    had proofs approved, which is correct but must be a decision somebody
 *    makes rather than something that happens to them.
 * 2. The payroll month has reached the cutoff. Employers accept declarations
 *    through the year and call proofs in near its end, so before the cutoff the
 *    declaration stands on its own.
 *
 * The cutoff is a month within the financial year, so the comparison runs on
 * the April-to-March order rather than the calendar one: January is month 10 of
 * the financial year, not month 1.
 */
export function verificationApplies(params: {
  proofVerificationRequired: boolean;
  proofCutoffMonth: number;
  payrollMonth: number;
}): boolean {
  const { proofVerificationRequired, proofCutoffMonth, payrollMonth } = params;
  if (!proofVerificationRequired) return false;
  return positionInFinancialYear(payrollMonth) >= positionInFinancialYear(proofCutoffMonth);
}

/** April is 1, March is 12. */
export function positionInFinancialYear(calendarMonth: number): number {
  return calendarMonth >= 4 ? calendarMonth - 3 : calendarMonth + 9;
}
