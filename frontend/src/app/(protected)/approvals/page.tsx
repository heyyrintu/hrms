'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Inbox,
  RefreshCw,
  XCircle,
} from 'lucide-react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ApprovalTrail } from '@/components/approvals/ApprovalTrail';
import {
  ApprovalDecisionKind,
  ApprovalNoteDialog,
} from '@/components/approvals/ApprovalNoteDialog';
import {
  InboxItem,
  WORKFLOW_ENTITY_LABELS,
  WORKFLOW_ENTITY_TYPES,
  workflowApi,
  WorkflowEntityType,
} from '@/lib/api-workflow';
import { cn, formatDate } from '@/lib/utils';

type Filter = 'ALL' | WorkflowEntityType;

interface PendingDecision {
  item: InboxItem;
  decision: ApprovalDecisionKind;
}

export default function MyApprovalsPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadInbox = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workflowApi.getInbox();
      setItems(res.data?.items ?? []);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to load your approvals');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const counts = useMemo(() => {
    const byType = Object.fromEntries(
      WORKFLOW_ENTITY_TYPES.map((t) => [t, 0]),
    ) as Record<WorkflowEntityType, number>;
    for (const item of items) byType[item.entityType] = (byType[item.entityType] ?? 0) + 1;
    return byType;
  }, [items]);

  const visible = filter === 'ALL' ? items : items.filter((i) => i.entityType === filter);

  const toggleTrail = (instanceId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) next.delete(instanceId);
      else next.add(instanceId);
      return next;
    });

  const handleConfirm = async (note: string) => {
    if (!pending) return;
    const { item, decision } = pending;
    setSubmitting(true);
    try {
      if (decision === 'approve') {
        await workflowApi.approve(item.entityType, item.entityId, note);
        toast.success('Request approved');
      } else {
        await workflowApi.reject(item.entityType, item.entityId, note);
        toast.success('Request rejected');
      }
      setPending(null);
      await loadInbox();
    } catch (error: any) {
      toast.error(
        error.response?.data?.message ||
          `Failed to ${decision === 'approve' ? 'approve' : 'reject'} the request`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const chip = (value: Filter, label: string, count: number) => (
    <button
      key={value}
      type="button"
      onClick={() => setFilter(value)}
      aria-pressed={filter === value}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors',
        filter === value
          ? 'border-primary-500 bg-primary-50 text-primary-700'
          : 'border-warm-200 bg-white text-warm-600 hover:bg-warm-50',
      )}
    >
      {label}
      <span className="rounded-full bg-warm-100 px-1.5 text-xs font-semibold text-warm-700">
        {count}
      </span>
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
            <Inbox className="w-7 h-7 text-primary-600" />
            My Approvals
          </h1>
          <p className="text-warm-600 mt-1">
            Everything waiting on you, across leave, expenses, loans and more
          </p>
        </div>
        <Button variant="secondary" onClick={loadInbox} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
        {chip('ALL', 'All', items.length)}
        {WORKFLOW_ENTITY_TYPES.map((t) => chip(t, WORKFLOW_ENTITY_LABELS[t], counts[t]))}
      </div>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent mx-auto" />
            <p className="mt-4 text-warm-600">Loading your approvals...</p>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CheckCircle className="w-16 h-16 text-warm-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-warm-900 mb-2">
              {items.length === 0 ? 'All caught up' : 'Nothing of this type'}
            </h3>
            <p className="text-warm-600">
              {items.length === 0
                ? 'No requests are waiting for your approval.'
                : 'Pick another filter to see the rest of your approvals.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => {
            const isOpen = expanded.has(item.instanceId);
            return (
              <Card key={item.instanceId}>
                <CardContent className="space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="default">{WORKFLOW_ENTITY_LABELS[item.entityType]}</Badge>
                        <span className="font-semibold text-warm-900">{item.title}</span>
                        {item.onBehalfOf && (
                          <Badge variant="info">On behalf of {item.onBehalfOf.name}</Badge>
                        )}
                      </div>
                      {item.subtitle && <p className="text-sm text-warm-600">{item.subtitle}</p>}
                      <p className="text-xs text-warm-500">
                        {item.requesterName ? `${item.requesterName} · ` : ''}
                        Submitted {formatDate(item.submittedAt)} · Step {item.currentStepOrder} of{' '}
                        {item.totalSteps}: {item.currentStepName}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={item.link}
                        className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
                      >
                        Open
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setPending({ item, decision: 'reject' })}
                        aria-label={`Reject ${item.title}`}
                      >
                        <XCircle className="h-4 w-4 mr-1" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setPending({ item, decision: 'approve' })}
                        aria-label={`Approve ${item.title}`}
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleTrail(item.instanceId)}
                    aria-expanded={isOpen}
                    className="inline-flex items-center gap-1 text-sm text-warm-600 hover:text-warm-900"
                  >
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    {isOpen ? 'Hide approval trail' : 'Show approval trail'}
                  </button>
                  {isOpen && (
                    <ApprovalTrail entityType={item.entityType} entityId={item.entityId} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ApprovalNoteDialog
        isOpen={pending !== null}
        decision={pending?.decision ?? 'approve'}
        subject={pending?.item.title}
        submitting={submitting}
        onCancel={() => setPending(null)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
