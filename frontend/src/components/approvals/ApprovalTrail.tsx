'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Clock, MinusCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn, formatDateTime } from '@/lib/utils';
import {
  APPROVER_TYPE_LABELS,
  ApprovalTrailStep,
  ApprovalTrailView,
  TrailStepState,
  workflowApi,
  WorkflowEntityType,
} from '@/lib/api-workflow';

const STATE_LABELS: Record<TrailStepState, string> = {
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PENDING: 'Awaiting action',
  WAITING: 'Waiting',
  CANCELLED: 'Cancelled',
};

const STATE_BADGE: Record<TrailStepState, 'success' | 'danger' | 'warning' | 'gray'> = {
  APPROVED: 'success',
  REJECTED: 'danger',
  PENDING: 'warning',
  WAITING: 'gray',
  CANCELLED: 'gray',
};

const STATUS_BADGE: Record<ApprovalTrailView['status'], 'success' | 'danger' | 'warning' | 'gray'> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'gray',
};

function StepIcon({ state }: { state: TrailStepState }) {
  const className = 'h-5 w-5 flex-shrink-0';
  switch (state) {
    case 'APPROVED':
      return <CheckCircle2 className={cn(className, 'text-emerald-600')} aria-hidden="true" />;
    case 'REJECTED':
      return <XCircle className={cn(className, 'text-red-600')} aria-hidden="true" />;
    case 'PENDING':
      return <Clock className={cn(className, 'text-amber-600')} aria-hidden="true" />;
    case 'CANCELLED':
      return <MinusCircle className={cn(className, 'text-warm-400')} aria-hidden="true" />;
    default:
      return <Circle className={cn(className, 'text-warm-300')} aria-hidden="true" />;
  }
}

function TrailStepRow({ step }: { step: ApprovalTrailStep }) {
  return (
    <li className="flex gap-3" data-testid={`trail-step-${step.order}`}>
      <StepIcon state={step.state} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-warm-900">
            {step.order}. {step.name}
          </span>
          <Badge variant={STATE_BADGE[step.state]}>{STATE_LABELS[step.state]}</Badge>
          {step.isOverride && <Badge variant="info">Admin override</Badge>}
        </div>
        <p className="text-xs text-warm-500">{APPROVER_TYPE_LABELS[step.approverType]}</p>
        {step.actedBy && (
          <p className="text-xs text-warm-600">
            {step.state === 'REJECTED' ? 'Rejected' : 'Approved'} by {step.actedBy.name}
            {step.onBehalfOf && <> on behalf of {step.onBehalfOf.name}</>}
            {step.actedAt && <> · {formatDateTime(step.actedAt)}</>}
          </p>
        )}
        {step.note && (
          <p className="rounded-md bg-warm-50 px-2 py-1 text-xs italic text-warm-700">
            &ldquo;{step.note}&rdquo;
          </p>
        )}
      </div>
    </li>
  );
}

/** Pure rendering of a trail, for callers that already have the data. */
export function ApprovalTrailSteps({ trail }: { trail: ApprovalTrailView }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-warm-500">
        <Badge variant={STATUS_BADGE[trail.status]}>{trail.status}</Badge>
        {trail.round > 1 && <span>Round {trail.round}</span>}
      </div>
      <ol className="space-y-3">
        {trail.steps.map((step) => (
          <TrailStepRow key={step.order} step={step} />
        ))}
      </ol>
    </div>
  );
}

interface ApprovalTrailProps {
  entityType: WorkflowEntityType;
  entityId: string;
  className?: string;
}

/**
 * Shared approval trail. Fetches on mount, so render it only when the user
 * expands it: that keeps a long inbox to one request instead of one per row.
 */
export function ApprovalTrail({ entityType, entityId, className }: ApprovalTrailProps) {
  const [trail, setTrail] = useState<ApprovalTrailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    workflowApi
      .getTrail(entityType, entityId)
      .then((res) => {
        if (!cancelled) setTrail(res.data);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(
          err?.response?.status === 404
            ? 'No approval trail for this request yet.'
            : err?.response?.data?.message || 'Failed to load the approval trail',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId]);

  return (
    <div className={cn('rounded-lg border border-warm-200 bg-white p-3', className)}>
      {loading ? (
        <p className="text-sm text-warm-500">Loading approval trail...</p>
      ) : error ? (
        <p className="text-sm text-warm-500">{error}</p>
      ) : trail ? (
        <ApprovalTrailSteps trail={trail} />
      ) : null}
    </div>
  );
}

export default ApprovalTrail;
