/**
 * Payslip line contract (Keka wave C). Frozen scaffold file.
 *
 * WS-C1 (payroll run mechanics) writes these lines into `Payslip.earnings` and
 * `Payslip.deductions`; WS-C2 (accounting export, variance report) reads them.
 * Spec: docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md, section C.0.
 *
 * Money identities after wave C:
 *   grossPay  = prorated basePay + taxable earning lines + otPay
 *   netPay    = grossPay + nonTaxableEarnings - totalDeductions
 * Statutory employee deductions and loan instalments also appear as deduction
 * lines by name (for the payslip view); their authoritative figures are the
 * Payslip columns (pfEmployee, esiEmployee, professionalTax, lwfEmployee, tds)
 * and the loan repayments.
 */

export type PayslipLineKind =
  /** A salary-structure component (the only kind before wave C). */
  | 'COMPONENT'
  /** Net arrears from backdated salary revisions ('Arrears' / 'Arrears recovery'). */
  | 'ARREAR'
  /** A PayrollOneTimePayment (bonus, incentive, recovery...). refId = payment id. */
  | 'ONE_TIME'
  /** Approved expense claims paid through payroll. Non-taxable. */
  | 'REIMBURSEMENT'
  /** Salary held in an earlier run, released here. Non-taxable. refId = hold id. */
  | 'HOLD_RELEASE'
  /** A settlement carried by an off-cycle run. refId = settlement id. */
  | 'SETTLEMENT'
  /** PF, ESI, professional tax, LWF, TDS deduction lines. */
  | 'STATUTORY'
  /** Loan EMI / salary advance recovery. */
  | 'LOAN';

/** One entry of `Payslip.earnings` / `Payslip.deductions` (JSON). */
export interface PayslipLine {
  name: string;
  /** Rupees, rounded to paise. Older rows may hold a string; read via Decimal. */
  amount: number;
  /** Absent on rows written before wave C; see classifyPayslipLine. */
  kind?: PayslipLineKind;
  /** Earnings only. Absent = taxable for COMPONENT/ARREAR/ONE_TIME. */
  taxable?: boolean;
  refId?: string | null;
}

/** Line names written by payroll. Kept here so readers can match them. */
export const ARREARS_LINE_NAME = 'Arrears';
export const ARREARS_RECOVERY_LINE_NAME = 'Arrears recovery';
export const REIMBURSEMENT_LINE_NAME = 'Reimbursements';
/** Followed by " (Mon YYYY)" of the held run, e.g. "Held salary release (Mar 2026)". */
export const HOLD_RELEASE_LINE_PREFIX = 'Held salary release';

/** Deduction line names the calculation pushes for statutory deductions. */
export const STATUTORY_DEDUCTION_LINE_NAMES: readonly string[] = [
  'Provident Fund',
  'ESI',
  'Professional Tax',
  'Labour Welfare Fund',
  'TDS',
];

/** Deduction line names the calculation pushes for loan instalments. */
export const LOAN_DEDUCTION_LINE_NAMES: readonly string[] = [
  'Loan EMI',
  'Salary advance recovery',
];

/**
 * The kind of a stored line, including lines written before wave C (no
 * `kind`): earnings are COMPONENT; deductions are STATUTORY or LOAN by name,
 * otherwise COMPONENT.
 */
export function classifyPayslipLine(
  line: Pick<PayslipLine, 'name' | 'kind'>,
  side: 'earning' | 'deduction',
): PayslipLineKind {
  if (line.kind) return line.kind;
  if (side === 'deduction') {
    if (STATUTORY_DEDUCTION_LINE_NAMES.includes(line.name)) return 'STATUTORY';
    if (LOAN_DEDUCTION_LINE_NAMES.includes(line.name)) return 'LOAN';
  }
  return 'COMPONENT';
}
