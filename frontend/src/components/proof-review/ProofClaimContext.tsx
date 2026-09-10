'use client';

/**
 * The claim, next to the rest of the employee's position under the same head.
 *
 * A claim on its own tells the reviewer nothing about whether accepting it is
 * reasonable. Accepting ₹1,50,000 under section 80C means one thing when
 * nothing has been approved yet and quite another when ₹1,20,000 already has.
 */

import { formatINR } from '@/components/form16/money';
import { financialYearLabel } from '@/components/form16/financialYear';
import {
  PROOF_SECTION_LABELS,
  type InvestmentProofSection,
  type ProofSummary,
} from '@/types/proofs';

interface ProofClaimContextProps {
  section: InvestmentProofSection;
  financialYear: number;
  /** The figure on the proof in front of the reviewer. */
  claimedAmount: string;
  /** Null while it is still being read, or if the read failed. */
  summary: ProofSummary | null;
  loading: boolean;
  failed: boolean;
}

function Figure({
  label,
  value,
  testId,
  hint,
}: {
  label: string;
  value: string;
  testId: string;
  hint?: string;
}) {
  return (
    <div data-testid={testId} className="rounded-lg border border-warm-200 bg-white px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-warm-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-warm-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-warm-500">{hint}</p> : null}
    </div>
  );
}

export function ProofClaimContext({
  section,
  financialYear,
  claimedAmount,
  summary,
  loading,
  failed,
}: ProofClaimContextProps) {
  const row = summary?.rows.find((candidate) => candidate.section === section) ?? null;

  return (
    <div className="rounded-lg bg-warm-50 p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-warm-500">
        {PROOF_SECTION_LABELS[section]} · {financialYearLabel(financialYear)}
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <Figure
          label="Declared"
          testId="context-declared"
          value={loading && !row ? '…' : formatINR(row?.declared)}
          hint="What the employee's declaration claims under this head."
        />
        <Figure
          label="Already approved"
          testId="context-approved"
          value={loading && !row ? '…' : formatINR(row?.approved)}
          hint="Accepted on this employee's earlier proofs."
        />
        <Figure
          label="This claim"
          testId="context-claimed"
          value={formatINR(claimedAmount)}
          hint="What this document is said to support."
        />
      </div>

      {row && row.pendingCount > 0 ? (
        <p className="mt-2 text-xs text-warm-600">
          {row.pendingCount === 1
            ? 'This is the only proof waiting under this head.'
            : `${row.pendingCount} proofs are waiting under this head, including this one.`}
          {row.rejectedCount > 0
            ? ` ${row.rejectedCount} ${row.rejectedCount === 1 ? 'has' : 'have'} been rejected.`
            : ''}
        </p>
      ) : null}

      {failed ? (
        <p className="mt-2 text-xs text-amber-700">
          The rest of this employee&apos;s position under this head could not be read, so the claim
          is shown on its own. Deciding without it is your call to make.
        </p>
      ) : null}

      {!loading && !failed && !row ? (
        <p className="mt-2 text-xs text-warm-600">
          Nothing else is recorded under this head for {financialYearLabel(financialYear)}.
        </p>
      ) : null}
    </div>
  );
}
