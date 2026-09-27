'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, RefreshCw, UserPlus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { employeesApi } from '@/lib/api';
import {
  recruitmentApi,
  type PreOnboardingInvite,
  type PreOnboardingStatus,
} from '@/lib/api-recruitment';

interface EmployeeOption {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

const STATUS_LABELS: Record<PreOnboardingStatus, string> = {
  INVITED: 'Invited',
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  COMPLETED: 'Completed',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
};

const STATUS_VARIANTS: Record<PreOnboardingStatus, BadgeVariant> = {
  INVITED: 'info',
  IN_PROGRESS: 'warning',
  SUBMITTED: 'success',
  COMPLETED: 'success',
  REVOKED: 'gray',
  EXPIRED: 'gray',
};

const LIVE_STATUSES: PreOnboardingStatus[] = ['INVITED', 'IN_PROGRESS', 'SUBMITTED'];

const FILTERS: Array<{ value: PreOnboardingStatus | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'INVITED', label: 'Invited' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REVOKED', label: 'Revoked' },
  { value: 'EXPIRED', label: 'Expired' },
];

function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** HR pre-onboarding invites: create, track, and review documents before day one. */
export default function PreOnboardingPage() {
  const [status, setStatus] = useState<PreOnboardingStatus | ''>('');
  const [invites, setInvites] = useState<PreOnboardingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [creating, setCreating] = useState(false);

  const [newLink, setNewLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recruitmentApi.listPreOnboarding(status ? { status } : undefined);
      setInvites(res.data ?? []);
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to load pre-onboarding invites'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = async () => {
    setCreateOpen(true);
    setEmployeeId('');
    setExpiresInDays('');
    try {
      const res = await employeesApi.getAll({ status: 'ACTIVE', limit: 500 });
      setEmployees(res.data?.data ?? res.data ?? []);
    } catch {
      toast.error('Failed to load employees');
    }
  };

  const create = async () => {
    if (!employeeId) {
      toast.error('Choose an employee');
      return;
    }
    setCreating(true);
    try {
      const res = await recruitmentApi.createPreOnboarding({
        employeeId,
        expiresInDays: expiresInDays.trim() ? Number(expiresInDays) : undefined,
      });
      setCreateOpen(false);
      setNewLink(res.data.link);
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to create the invite'));
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      await recruitmentApi.revokePreOnboarding(id);
      toast.success('Invite revoked');
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to revoke the invite'));
    } finally {
      setBusyId(null);
    }
  };

  const resend = async (id: string) => {
    setBusyId(id);
    try {
      const res = await recruitmentApi.resendPreOnboarding(id);
      setNewLink(res.data.link);
      toast.success('Invite resent');
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to resend the invite'));
    } finally {
      setBusyId(null);
    }
  };

  const complete = async (id: string) => {
    setBusyId(id);
    try {
      await recruitmentApi.completePreOnboarding(id);
      toast.success('Marked complete');
      load();
    } catch (error) {
      toast.error(apiErrorMessage(error, 'Failed to mark complete'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900">Pre-onboarding</h1>
          <p className="text-sm text-warm-500">Invite new joiners to submit their details and documents before day one.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}>
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            <UserPlus className="mr-1 h-4 w-4" /> New invite
          </Button>
        </div>
      </div>

      {newLink && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <span>Link ready (shown once — it has also been emailed):</span>
          <code className="rounded bg-white px-2 py-1 text-xs">{newLink}</code>
          <Button size="sm" variant="secondary" onClick={() => copyLink(newLink)}>
            <Copy className="mr-1 h-4 w-4" /> Copy
          </Button>
          <button type="button" className="text-xs text-emerald-700 underline" onClick={() => setNewLink(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value || 'all'}
            role="tab"
            aria-selected={status === f.value}
            onClick={() => setStatus(f.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              status === f.value ? 'bg-primary-600 text-white' : 'bg-warm-100 text-warm-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {loading ? (
            <p className="p-6 text-sm text-warm-500">Loading invites…</p>
          ) : invites.length === 0 ? (
            <p className="p-6 text-center text-sm text-warm-500">No pre-onboarding invites{status ? ' with this status' : ' yet'}.</p>
          ) : (
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-warm-200 bg-warm-50 text-xs uppercase text-warm-500">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Join date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Documents</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => {
                  const uploadedCount = invite.documents.filter((d) => d.uploaded).length;
                  const isLive = LIVE_STATUSES.includes(invite.status);
                  return (
                    <Fragment key={invite.id}>
                      <tr className="border-b border-warm-100 last:border-0">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className="font-medium text-primary-600 hover:underline"
                            onClick={() => setExpandedId(expandedId === invite.id ? null : invite.id)}
                          >
                            {invite.employee.firstName} {invite.employee.lastName}
                          </button>
                          <p className="text-xs text-warm-500">{invite.employee.employeeCode}</p>
                        </td>
                        <td className="px-4 py-3">{formatDate(invite.employee.joinDate)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_VARIANTS[invite.status]}>{STATUS_LABELS[invite.status]}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {uploadedCount}/{invite.documents.length}
                        </td>
                        <td className="px-4 py-3 text-warm-600">{formatDate(invite.expiresAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            {isLive && (
                              <Button size="sm" variant="secondary" disabled={busyId === invite.id} onClick={() => resend(invite.id)}>
                                Resend
                              </Button>
                            )}
                            {isLive && (
                              <Button size="sm" variant="ghost" disabled={busyId === invite.id} onClick={() => revoke(invite.id)}>
                                Revoke
                              </Button>
                            )}
                            {invite.status === 'SUBMITTED' && (
                              <Button size="sm" disabled={busyId === invite.id} onClick={() => complete(invite.id)}>
                                Complete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandedId === invite.id && (
                        <tr className="border-b border-warm-100 bg-warm-50">
                          <td colSpan={6} className="px-4 py-3">
                            <p className="mb-2 text-xs font-semibold uppercase text-warm-500">Documents</p>
                            <ul className="space-y-1 text-sm">
                              {invite.documents.map((doc) => (
                                <li key={doc.key} className="flex items-center justify-between">
                                  <span>
                                    {doc.label}
                                    {doc.required && <span className="ml-1 text-primary-500">*</span>}
                                  </span>
                                  <span className={doc.uploaded ? 'text-emerald-700' : 'text-warm-500'}>
                                    {doc.uploaded ? doc.fileName ?? 'Uploaded' : 'Not uploaded'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="Invite an employee to pre-onboarding">
        <div className="space-y-4">
          <Select
            label="Employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            options={[
              { value: '', label: 'Choose an employee' },
              ...employees.map((e) => ({ value: e.id, label: `${e.employeeCode} — ${e.firstName} ${e.lastName}` })),
            ]}
          />
          <Input
            label="Expires in days (optional, uses the tenant default)"
            type="number"
            min={1}
            max={30}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={creating}>
              Send invite
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
