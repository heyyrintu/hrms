'use client';

/**
 * One submitted document and where it stands.
 *
 * Two things this must never do. It must not show a rejection without the
 * reason for it — an employee whose evidence is refused is owed that, and when
 * no reason was recorded the absence is stated rather than hidden. And it must
 * not show only the accepted figure on a partial approval: somebody who claimed
 * ₹1,50,000 and had ₹80,000 accepted needs to see the shortfall, not a tidy
 * number that looks like success.
 */

import { Download, FileText, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { formatINR } from '@/components/form16/money';
import {
  InvestmentProofStatus,
  PROOF_SECTION_LABELS,
  type InvestmentProof,
} from '@/types/proofs';

import { subtractAmounts, isGreaterThan } from './decimal';

const STATUS_LABELS: Record<InvestmentProofStatus, string> = {
  [InvestmentProofStatus.PENDING]: 'Awaiting review',
  [InvestmentProofStatus.APPROVED]: 'Approved',
  [InvestmentProofStatus.REJECTED]: 'Rejected',
};

const STATUS_VARIANTS: Record<InvestmentProofStatus, 'warning' | 'success' | 'danger'> = {
  [InvestmentProofStatus.PENDING]: 'warning',
  [InvestmentProofStatus.APPROVED]: 'success',
  [InvestmentProofStatus.REJECTED]: 'danger',
};

/** A date a person can read, falling back to the raw value rather than guessing. */
function readableDate(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function Figure({
  label,
  amount,
  testId,
  tone = 'plain',
}: {
  label: string;
  amount: string | null;
  testId: string;
  tone?: 'plain' | 'short';
}) {
  return (
    <div>
      <dt className="text-xs text-warm-500">{label}</dt>
      <dd
        data-testid={testId}
        className={`text-sm font-semibold tabular-nums ${
          tone === 'short' ? 'text-amber-700' : 'text-warm-900'
        }`}
      >
        {amount === null ? '—' : formatINR(amount)}
      </dd>
    </div>
  );
}

export interface ProofListItemProps {
  proof: InvestmentProof;
  /** Offered only while the proof is still pending; a reviewed one is a record. */
  onWithdraw: (proof: InvestmentProof) => void;
  onDownload: (proof: InvestmentProof) => void;
  busy?: boolean;
}

export function ProofListItem({ proof, onWithdraw, onDownload, busy }: ProofListItemProps) {
  const isPending = proof.status === InvestmentProofStatus.PENDING;
  const isRejected = proof.status === InvestmentProofStatus.REJECTED;
  const isApproved = proof.status === InvestmentProofStatus.APPROVED;

  // A partial approval: less was accepted than was claimed. Computed on exact
  // scaled integers, so the shortfall is the difference of the stored figures.
  const shortfall = isApproved && isGreaterThan(proof.claimedAmount, proof.verifiedAmount)
    ? subtractAmounts(proof.claimedAmount, proof.verifiedAmount)
    : null;

  const submittedOn = readableDate(proof.createdAt);
  const reviewedOn = readableDate(proof.reviewedAt);

  return (
    <div data-testid={`proof-${proof.id}`}>
      <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-warm-900">
                {PROOF_SECTION_LABELS[proof.section] ?? proof.section}
              </h3>
              <Badge variant={STATUS_VARIANTS[proof.status]}>
                {STATUS_LABELS[proof.status] ?? proof.status}
              </Badge>
            </div>
            <p className="text-xs text-warm-500">
              {submittedOn ? `Submitted ${submittedOn}` : 'Submitted'}
              {reviewedOn ? ` · Reviewed ${reviewedOn}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => onDownload(proof)}
              disabled={busy}
              aria-label={`Download ${proof.upload?.fileName ?? 'the document'}`}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              Download
            </Button>
            {isPending ? (
              <Button variant="secondary" onClick={() => onWithdraw(proof)} disabled={busy}>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Withdraw
              </Button>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          <Figure label="Claimed" amount={proof.claimedAmount} testId="claimed" />
          {isApproved ? (
            <Figure label="Accepted" amount={proof.verifiedAmount} testId="accepted" />
          ) : null}
          {shortfall ? (
            <Figure label="Not accepted" amount={shortfall} testId="shortfall" tone="short" />
          ) : null}
        </dl>

        {shortfall ? (
          <p className="text-sm text-amber-800">
            {formatINR(shortfall)} of what you claimed was not accepted, so only the accepted
            figure counts towards your tax.
          </p>
        ) : null}

        {proof.description ? (
          <p className="text-sm text-warm-600">{proof.description}</p>
        ) : null}

        {proof.upload ? (
          <p className="flex items-center gap-2 text-xs text-warm-500">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            {proof.upload.fileName}
          </p>
        ) : null}

        {isPending ? (
          <p className="text-sm text-warm-600">
            A person in payroll has yet to look at this. Nothing it claims counts until they
            approve it.
          </p>
        ) : null}

        {/* A rejection is never rendered without its reason. */}
        {isRejected ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
              Why this was rejected
            </p>
            <p data-testid="review-reason" className="mt-1 text-sm text-red-900">
              {proof.reviewNote?.trim()
                ? proof.reviewNote
                : 'No reason was recorded. Ask payroll why this document was refused before submitting another.'}
            </p>
          </div>
        ) : null}

        {isApproved && proof.reviewNote?.trim() ? (
          <div className="rounded-lg border border-warm-200 bg-warm-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-warm-600">
              Reviewer&rsquo;s note
            </p>
            <p data-testid="review-reason" className="mt-1 text-sm text-warm-700">
              {proof.reviewNote}
            </p>
          </div>
        ) : null}
      </CardContent>
      </Card>
    </div>
  );
}
