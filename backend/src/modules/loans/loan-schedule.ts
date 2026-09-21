/**
 * The repayment maths for employee loans and salary advances.
 *
 * Pure functions with no Prisma or Nest dependency, so the schedule shown in
 * the UI, the schedule stored against a loan and the schedule payroll deducts
 * from are all the same arithmetic rather than three near-copies of it.
 *
 * Interest is *simple*, not reducing balance: the whole interest is computed
 * once on the original principal and then spread evenly across the tenure.
 * That is what the business asked for and it is what an Indian salary-advance
 * or staff-loan facility usually quotes.
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

/**
 * Round to paise. The `toFixed(6)` pass first is not decoration: values like
 * `1000.0000000000001` arrive out of the float arithmetic above and would
 * otherwise round up a whole paisa.
 */
export function round2(value: number): number {
  return Math.round(Number((value * 100).toFixed(6))) / 100;
}

/** Round *up* to paise, for the EMI so the instalments never undershoot. */
export function ceil2(value: number): number {
  return Math.ceil(Number((value * 100).toFixed(6))) / 100;
}

/** Simple interest over the whole tenure, on the original principal. */
export function computeTotalPayable(
  principal: number,
  interestRate: number,
  tenureMonths: number,
): number {
  const interest = (principal * interestRate * tenureMonths) / (100 * 12);
  return round2(principal + interest);
}

/** The level instalment, rounded up so the last row absorbs the difference. */
export function computeEmi(totalPayable: number, tenureMonths: number): number {
  return ceil2(totalPayable / tenureMonths);
}

/**
 * The full instalment schedule, one row per month of the tenure.
 *
 * Every row but the last carries the level EMI. The last row carries whatever
 * is left, which is always slightly *less* because the EMI was rounded up, so
 * the rows sum to `totalPayable` exactly and the borrower never overpays.
 */
export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  const { principal, interestRate, tenureMonths, startMonth, startYear } =
    input;

  if (!Number.isInteger(tenureMonths) || tenureMonths < 1) {
    throw new Error('tenureMonths must be a positive integer');
  }
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new Error('startMonth must be between 1 and 12');
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
