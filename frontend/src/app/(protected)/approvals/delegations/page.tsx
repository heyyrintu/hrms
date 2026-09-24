'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { RefreshCw, UserCheck, UserPlus } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { PickedUser, UserSearchPicker } from '@/components/approvals/UserSearchPicker';
import { useAuth } from '@/contexts/AuthContext';
import {
  DelegationView,
  WORKFLOW_ENTITY_LABELS,
  WORKFLOW_ENTITY_TYPES,
  workflowApi,
  WorkflowEntityType,
} from '@/lib/api-workflow';
import { parseLocalDate, todayLocalIso } from '@/lib/date';
import { cn, formatDate } from '@/lib/utils';

interface DelegationForm {
  delegate: PickedUser | null;
  startDate: string;
  endDate: string;
  entityType: '' | WorkflowEntityType;
  reason: string;
}

const emptyForm = (): DelegationForm => ({
  delegate: null,
  startDate: todayLocalIso(),
  endDate: todayLocalIso(),
  entityType: '',
  reason: '',
});

function delegationStatus(d: DelegationView): {
  label: string;
  variant: 'success' | 'info' | 'gray';
} {
  if (!d.isActive) return { label: 'Cancelled', variant: 'gray' };
  if (d.isCurrent) return { label: 'Active now', variant: 'success' };
  // YYYY-MM-DD strings compare correctly as text.
  if (d.endDate < todayLocalIso()) return { label: 'Ended', variant: 'gray' };
  return { label: 'Upcoming', variant: 'info' };
}

const formatDay = (iso: string) => formatDate(parseLocalDate(iso));

function DelegationRow({
  delegation,
  counterpart,
  onCancel,
  cancelling,
}: {
  delegation: DelegationView;
  counterpart: string;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const status = delegationStatus(delegation);
  const canCancel =
    onCancel && delegation.isActive && delegation.endDate >= todayLocalIso();
  return (
    <li
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3"
      data-testid={`delegation-${delegation.id}`}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-warm-900">{counterpart}</span>
          <Badge variant={status.variant}>{status.label}</Badge>
          <Badge variant="gray">
            {delegation.entityType ? WORKFLOW_ENTITY_LABELS[delegation.entityType] : 'All types'}
          </Badge>
        </div>
        <p className="text-sm text-warm-600">
          {formatDay(delegation.startDate)} – {formatDay(delegation.endDate)}
        </p>
        {delegation.reason && <p className="text-xs text-warm-500">{delegation.reason}</p>}
      </div>
      {canCancel && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onCancel}
          loading={cancelling}
          aria-label={`Cancel delegation to ${counterpart}`}
        >
          Cancel
        </Button>
      )}
    </li>
  );
}

export default function DelegationsPage() {
  const { user } = useAuth();
  const [given, setGiven] = useState<DelegationView[]>([]);
  const [received, setReceived] = useState<DelegationView[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<DelegationForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workflowApi.getDelegations();
      setGiven(res.data?.given ?? []);
      setReceived(res.data?.received ?? []);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to load delegations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof DelegationForm>(key: K, value: DelegationForm[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleCreate = async () => {
    if (!form.delegate) {
      toast.error('Pick who should approve for you');
      return;
    }
    if (!form.startDate || !form.endDate) {
      toast.error('Pick a start and end date');
      return;
    }
    if (form.endDate < form.startDate) {
      toast.error('End date cannot be before the start date');
      return;
    }

    setSaving(true);
    try {
      const reason = form.reason.trim();
      await workflowApi.createDelegation({
        delegateUserId: form.delegate.id,
        startDate: form.startDate,
        endDate: form.endDate,
        ...(form.entityType ? { entityType: form.entityType } : {}),
        ...(reason ? { reason } : {}),
      });
      toast.success(`Delegated to ${form.delegate.name}`);
      setForm(emptyForm());
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create the delegation');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (delegation: DelegationView) => {
    if (!window.confirm(`Cancel the delegation to ${delegation.delegate.name}?`)) return;
    setCancellingId(delegation.id);
    try {
      await workflowApi.cancelDelegation(delegation.id);
      toast.success('Delegation cancelled');
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to cancel the delegation');
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
            <UserCheck className="w-7 h-7 text-primary-600" />
            Approval Delegations
          </h1>
          <p className="text-warm-600 mt-1">
            Let someone approve on your behalf while you are away
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New delegation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UserSearchPicker
            label="Delegate to"
            value={form.delegate}
            onChange={(u) => set('delegate', u)}
            excludeUserId={user?.id}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Start date"
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
            />
            <Input
              label="End date"
              type="date"
              min={form.startDate || undefined}
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
            />
          </div>
          <Select
            id="delegation-entity-type"
            label="Request type"
            value={form.entityType}
            onChange={(e) => set('entityType', e.target.value as DelegationForm['entityType'])}
          >
            <option value="">All types</option>
            {WORKFLOW_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {WORKFLOW_ENTITY_LABELS[t]}
              </option>
            ))}
          </Select>
          <Input
            label="Reason (optional)"
            maxLength={500}
            value={form.reason}
            placeholder="e.g. On annual leave"
            onChange={(e) => set('reason', e.target.value)}
          />
          <div className="flex justify-end">
            <Button onClick={handleCreate} loading={saving}>
              <UserPlus className="h-4 w-4 mr-2" />
              Create delegation
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>I delegated</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && given.length === 0 ? (
              <p className="text-sm text-warm-500">Loading...</p>
            ) : given.length === 0 ? (
              <p className="text-sm text-warm-500">You have not delegated your approvals.</p>
            ) : (
              <ul className="divide-y divide-warm-100">
                {given.map((d) => (
                  <DelegationRow
                    key={d.id}
                    delegation={d}
                    counterpart={d.delegate.name}
                    onCancel={() => handleCancel(d)}
                    cancelling={cancellingId === d.id}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Delegated to me</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && received.length === 0 ? (
              <p className="text-sm text-warm-500">Loading...</p>
            ) : received.length === 0 ? (
              <p className="text-sm text-warm-500">Nobody has delegated approvals to you.</p>
            ) : (
              <ul className="divide-y divide-warm-100">
                {received.map((d) => (
                  <DelegationRow key={d.id} delegation={d} counterpart={d.delegator.name} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
