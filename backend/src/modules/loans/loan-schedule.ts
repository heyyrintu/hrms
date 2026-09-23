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

export interface Period {
  month: number;
  year: number;
}

export interface ArrearsInstalment extends Period {
  amount: number;
}

export interface LoanArrears {
  /** The balance the remaining scheduled EMIs will not cover. */
  amount: number;
  /** When payroll is expected to collect it, one EMI at most per month. */
  instalments: ArrearsInstalment[];
}

const periodIndex = (p: Period) => p.year * 12 + (p.month - 1);
const periodAt = (index: number): Period => ({
  month: (index % 12) + 1,
  year: Math.floor(index / 12),
});

/**
 * What a loan owes beyond its schedule, and when payroll will take it.
 *
 * Payroll never deducts more than a month's scheduled EMI during the tenure,
 * and never drives net pay below zero: where net pay is too small it takes
 * less (see the payroll calculation's clamp), and a month payroll did not run
 * takes nothing. The shortfall is not lost — once the tenure ends, payroll
 * keeps deducting up to one EMI a month until the balance is clear. That
 * post-tenure deduction is what this works out, so it can be explained to the
 * borrower before it appears on a payslip.
 *
 * `amount` is the outstanding balance less every scheduled EMI still to come:
 * the rows from `asOf` onward that payroll has not already collected. A past
 * row payroll never collected is not "still to come", so its EMI counts
 * towards arrears too. Collection starts the month after the final row, or
 * `asOf` if the tenure is already over — the month after, if this month's
 * payroll has already run.
 *
 * Mirrors `getPayrollDeductions` exactly; if that changes, this must too.
 */
export function computeArrears(input: {
  schedule: ScheduleRow[];
  outstanding: number;
  emiAmount: number;
  /** Months payroll has already recorded a repayment for. */
  payrollMonths: Period[];
  asOf: Period;
}): LoanArrears {
  const none: LoanArrears = { amount: 0, instalments: [] };
  const { schedule, outstanding, emiAmount, payrollMonths, asOf } = input;
  if (!(outstanding > 0) || !(emiAmount > 0)) return none;

  const collected = new Set(payrollMonths.map(periodIndex));
  const now = periodIndex(asOf);

  const stillScheduled = schedule
    .filter((row) => periodIndex(row) >= now && !collected.has(periodIndex(row)))
    .reduce((sum, row) => round2(sum + row.emi), 0);

  const amount = round2(outstanding - stillScheduled);
  if (amount <= 0) return none;

  const lastRow = schedule.length
    ? periodIndex(schedule[schedule.length - 1])
    : now - 1;
  let next = Math.max(lastRow + 1, now);
  if (next === now && collected.has(now)) next += 1;

  const instalments: ArrearsInstalment[] = [];
  let left = amount;
  while (left > 0) {
    const take = round2(Math.min(emiAmount, left));
    instalments.push({ ...periodAt(next), amount: take });
    left = round2(left - take);
    next += 1;
  }

  return { amount, instalments };
}
