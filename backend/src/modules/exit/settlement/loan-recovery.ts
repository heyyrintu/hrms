import { Decimal } from '@prisma/client/runtime/library';

/**
 * Recovering a leaver's outstanding loans and salary advances from their
 * final settlement.
 *
 * Pure, so the arithmetic can be tested apart from the settlement flow. The
 * settlement service loads the balances, calls this with what the settlement
 * can bear, and stores the result in its breakdown; approval later reads the
 * stored lines back to write the matching loan repayments.
 *
 * The rule: a recovery never takes the net payable below zero. Notice
 * recovery may (the employer is owed that either way and it is shown as a
 * negative net), but a loan recovery is a set-off against money being paid,
 * and there is nothing to set off against a payment that does not exist.
 * What cannot be recovered is not dropped: it stays owed on the loan, and is
 * reported line by line as unrecovered so someone can chase it.
 */

/** One loan still owed, as the loans service reports it. */
export interface OutstandingLoan {
  loanId: string;
  type: string;
  outstanding: Decimal;
}

export interface LoanRecoveryLine extends OutstandingLoan {
  label: string;
  recovered: Decimal;
  unrecovered: Decimal;
}

export interface LoanRecoveryResult {
  lines: LoanRecoveryLine[];
  /** Sum of `recovered`: the figure that joins the settlement's recoveries. */
  total: Decimal;
  /** Sum of `unrecovered`: still owed after the settlement. */
  unrecovered: Decimal;
  /** What the settlement could bear, floored at zero. */
  available: Decimal;
}

/** One stored line, as it sits in the breakdown JSON. */
export interface StoredLoanRecoveryLine {
  loanId: string;
  type: string;
  label: string;
  outstanding: string;
  recovered: string;
  unrecovered: string;
}

export interface StoredLoanRecovery {
  loans: StoredLoanRecoveryLine[];
  total: string;
  unrecovered: string;
  available: string;
  note: string;
}

const ZERO = new Decimal(0);

function money(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function labelFor(type: string): string {
  return type === 'SALARY_ADVANCE' ? 'Salary advance recovery' : 'Loan recovery';
}

/**
 * Spread `available` across the loans in the order given — the loans service
 * returns them oldest first, which is the order payroll services them in too.
 */
export function allocateLoanRecovery(
  loans: OutstandingLoan[],
  available: Decimal,
): LoanRecoveryResult {
  let left = Decimal.max(money(available), ZERO);
  const cap = left;
  const lines: LoanRecoveryLine[] = [];

  for (const loan of loans) {
    const outstanding = money(new Decimal(loan.outstanding));
    if (outstanding.lte(0)) continue;

    const recovered = Decimal.min(outstanding, left);
    left = left.sub(recovered);
    lines.push({
      loanId: loan.loanId,
      type: loan.type,
      label: labelFor(loan.type),
      outstanding,
      recovered,
      unrecovered: outstanding.sub(recovered),
    });
  }

  return {
    lines,
    total: money(lines.reduce((sum, l) => sum.add(l.recovered), ZERO)),
    unrecovered: money(lines.reduce((sum, l) => sum.add(l.unrecovered), ZERO)),
    available: cap,
  };
}

/** The breakdown block, as fixed-point strings like the rest of it. */
export function toStoredLoanRecovery(result: LoanRecoveryResult): StoredLoanRecovery {
  return {
    loans: result.lines.map((l) => ({
      loanId: l.loanId,
      type: l.type,
      label: l.label,
      outstanding: l.outstanding.toFixed(2),
      recovered: l.recovered.toFixed(2),
      unrecovered: l.unrecovered.toFixed(2),
    })),
    total: result.total.toFixed(2),
    unrecovered: result.unrecovered.toFixed(2),
    available: result.available.toFixed(2),
    note:
      'Outstanding loan and salary-advance balances are recovered from what is ' +
      'left after notice recovery, other recoveries and TDS, oldest first, and ' +
      'never take the net payable below zero. Anything not recovered stays owed ' +
      'on the loan and is shown as unrecovered. Do not also enter these balances ' +
      'under other recoveries.',
  };
}

/**
 * The loan lines a stored breakdown carries, as money again.
 *
 * A breakdown computed before loan recovery existed has no block, which reads
 * as no loans. A block that is there but does not parse is refused, not
 * guessed at: these figures become repayment rows on approval.
 */
export function readStoredLoanRecovery(
  breakdown: unknown,
): { loanId: string; type: string; outstanding: Decimal; recovered: Decimal }[] {
  const block = (breakdown as { loanRecovery?: { loans?: unknown } } | null)?.loanRecovery;
  if (!block || !Array.isArray(block.loans)) return [];

  return block.loans.map((raw: unknown) => {
    const line = raw as Partial<StoredLoanRecoveryLine>;
    if (typeof line.loanId !== 'string' || !line.loanId) {
      throw new Error('Stored loan recovery line has no loan id');
    }
    const outstanding = new Decimal(String(line.outstanding));
    const recovered = new Decimal(String(line.recovered));
    if (!outstanding.isFinite() || !recovered.isFinite()) {
      throw new Error(`Stored loan recovery for ${line.loanId} is not a number`);
    }
    return {
      loanId: line.loanId,
      type: typeof line.type === 'string' ? line.type : 'LOAN',
      outstanding,
      recovered,
    };
  });
}
