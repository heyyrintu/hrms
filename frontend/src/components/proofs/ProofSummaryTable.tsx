'use client';

/**
 * Declared against approved, head by head.
 *
 * The point of the whole workflow is the gap between the two, so both are shown
 * side by side and the difference is spelled out rather than left to be worked
 * out in the reader's head. Every figure comes from the stored decimal string;
 * the difference is computed on exact scaled integers, never a float.
 */

import { PROOF_SECTION_LABELS, type ProofSummaryRow } from '@/types/proofs';
import { formatINR } from '@/components/form16/money';

import { subtractAmounts, isPositiveAmount } from './decimal';

/** What is declared but not yet approved, never below nil. */
function stillUnproved(row: ProofSummaryRow): string | null {
  const difference = subtractAmounts(row.declared, row.approved);
  if (difference === null) return null;
  // More approved than declared leaves nothing unproved. Showing a negative
  // gap here would read as a debt rather than as "this head is covered".
  return difference.startsWith('-') ? '0.00' : difference;
}

export function ProofSummaryTable({ rows }: { rows: ProofSummaryRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-warm-500">
        No heads to show for this year yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-warm-200 text-left text-xs uppercase tracking-wide text-warm-500">
            <th scope="col" className="py-2 pr-4 font-medium">
              Head
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Declared
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Approved
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Still unproved
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Your proofs
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const unproved = stillUnproved(row);
            const hasGap = isPositiveAmount(unproved);

            return (
              <tr
                key={row.section}
                data-testid={`summary-row-${row.section}`}
                className="border-b border-warm-100 last:border-0"
              >
                <th scope="row" className="py-2.5 pr-4 text-left font-medium text-warm-800">
                  {PROOF_SECTION_LABELS[row.section] ?? row.section}
                </th>
                <td
                  data-testid="declared"
                  className="py-2.5 pr-4 text-right tabular-nums text-warm-800"
                >
                  {formatINR(row.declared)}
                </td>
                <td
                  data-testid="approved"
                  className="py-2.5 pr-4 text-right tabular-nums text-warm-800"
                >
                  {formatINR(row.approved)}
                </td>
                <td
                  data-testid="unproved"
                  className={`py-2.5 pr-4 text-right font-medium tabular-nums ${
                    hasGap ? 'text-amber-700' : 'text-warm-500'
                  }`}
                >
                  {unproved === null ? '—' : formatINR(unproved)}
                </td>
                <td className="py-2.5 text-right text-xs text-warm-500">
                  {row.pendingCount === 0 && row.rejectedCount === 0 ? (
                    <span>—</span>
                  ) : (
                    <span className="space-x-2">
                      {row.pendingCount > 0 ? (
                        <span data-testid="pending-count">
                          {row.pendingCount} awaiting review
                        </span>
                      ) : null}
                      {row.rejectedCount > 0 ? (
                        <span data-testid="rejected-count" className="text-red-600">
                          {row.rejectedCount} rejected
                        </span>
                      ) : null}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
