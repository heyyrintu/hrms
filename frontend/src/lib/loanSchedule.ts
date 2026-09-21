/**
 * The loan repayment maths, in the browser.
 *
 * This is a deliberate mirror of `backend/src/modules/loans/loan-schedule.ts`.
 * The request form shows an employee what they will actually pay each month
 * before they submit, and the number it shows has to be the number the server
 * stores — a preview that drifts from the stored EMI is worse than no preview,
 * because the employee agreed to the wrong figure.
 *
 * Interest is simple, not reducing balance: charged once on the original
 * principal for the whole tenure, then spread evenly across the instalments.
 */

export interface ScheduleInput {
  principal: number;
  interestRate: number;
  tenureMonths: number;
  startMonth: number;
  startYear: number;
}

export interface ScheduleRow {
  month: number;
  year: number;
  emi: number;
  principalComponent: number;
  interestComponent: number;
  balanceAfter: number;
}

/** Round to paise, without letting a float artefact carry a whole paisa. */
export function round2(value: number): number {
  return Math.round(Number((value * 100).toFixed(6))) / 100;
}

/** Round up to paise, so the level instalments never undershoot the total. */
export function ceil2(value: number): number {
  return Math.ceil(Number((value * 100).toFixed(6))) / 100;
}

export function computeTotalPayable(
  principal: number,
  interestRate: number,
  tenureMonths: number,
): number {
  const interest = (principal * interestRate * tenureMonths) / (100 * 12);
  return round2(principal + interest);
}

export function computeEmi(totalPayable: number, tenureMonths: number): number {
  return ceil2(totalPayable / tenureMonths);
}

/**
 * The whole instalment plan. Every row but the last carries the level EMI;
 * the last carries the remainder, which is slightly smaller because the EMI
 * was rounded up, so the rows sum to `totalPayable` exactly.
 *
 * Returns `[]` rather than throwing on nonsense input: this runs on every
 * keystroke in a form where the tenure field is briefly empty.
 */
export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const { principal, interestRate, tenureMonths, startMonth, startYear } =
    input;

  if (
    !Number.isFinite(principal) ||
    principal <= 0 ||
    !Number.isInteger(tenureMonths) ||
    tenureMonths < 1 ||
    !Number.isInteger(startMonth) ||
    startMonth < 1 ||
    startMonth > 12
  ) {
    return [];
  }

  const totalPayable = computeTotalPayable(
    principal,
    interestRate,
    tenureMonths,
  );
  const emi = computeEmi(totalPayable, tenureMonths);
  const totalInterest = round2(totalPayable - principal);
  const interestPerMonth = round2(totalInterest / tenureMonths);

  const rows: ScheduleRow[] = [];
  let paidSoFar = 0;
  let interestSoFar = 0;

  for (let i = 0; i < tenureMonths; i++) {
    const isLast = i === tenureMonths - 1;
    const rowEmi = isLast ? round2(totalPayable - paidSoFar) : emi;
    const rowInterest = isLast
      ? round2(totalInterest - interestSoFar)
      : interestPerMonth;

    paidSoFar = round2(paidSoFar + rowEmi);
    interestSoFar = round2(interestSoFar + rowInterest);

    const offset = startMonth - 1 + i;
    rows.push({
      month: (offset % 12) + 1,
      year: startYear + Math.floor(offset / 12),
      emi: rowEmi,
      principalComponent: round2(rowEmi - rowInterest),
      interestComponent: rowInterest,
      balanceAfter: round2(totalPayable - paidSoFar),
    });
  }

  return rows;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "Mar 2026" for a schedule row. */
export function formatPeriod(month: number, year: number): string {
  const name = MONTH_NAMES[month - 1];
  return name ? `${name} ${year}` : `${month}/${year}`;
}
