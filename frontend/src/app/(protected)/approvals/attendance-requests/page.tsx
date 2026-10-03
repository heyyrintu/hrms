'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import {
  attendanceRequestsApi,
  type AttendanceRequest,
  type AttendanceRequestType,
} from '@/lib/api-attendance-requests';
import { formatDate, cn } from '@/lib/utils';
import { CheckCircle2, ClipboardCheck, RefreshCw, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const TYPE_LABEL: Record<AttendanceRequestType, string> = {
  WFH: 'Work from home',
  ON_DUTY: 'On duty',
};

const dayPart = (iso: string) => iso.slice(0, 10);

export default function AttendanceRequestApprovalsPage() {
  const [requests, setRequests] = useState<AttendanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [reviewing, setReviewing] = useState<AttendanceRequest | null>(null);
  const [action, setAction] = useState<'approve' | 'reject'>('approve');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await attendanceRequestsApi.getPendingApprovals();
      setRequests(res.data || []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = (request: AttendanceRequest, next: 'approve' | 'reject') => {
    setReviewing(request);
    setAction(next);
    setNote('');
  };

  const decide = async () => {
    if (!reviewing) return;
    setSaving(true);
    try {
      if (action === 'approve') {
        await attendanceRequestsApi.approve(reviewing.id, note.trim() || undefined);
        toast.success('Request approved');
      } else {
        await attendanceRequestsApi.reject(reviewing.id, note.trim() || undefined);
        toast.success('Request rejected');
      }
      setReviewing(null);
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || `Failed to ${action} the request`);
    } finally {
      setSaving(false);
    }
  };

  const name = (r: AttendanceRequest) =>
    r.employee ? `${r.employee.firstName} ${r.employee.lastName}` : 'Unknown';

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
              <ClipboardCheck className="w-7 h-7 text-primary-600" />
              Work from home and on-duty approvals
            </h1>
            <p className="text-warm-600 mt-1">Review requests waiting on you</p>
          </div>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : loadError ? (
          <Card>
            <CardContent className="py-16 text-center space-y-3">
              <p className="text-warm-700">Failed to load pending requests</p>
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <CheckCircle2 className="w-16 h-16 text-emerald-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-warm-900 mb-2">All caught up</h3>
              <p className="text-warm-600">No work-from-home or on-duty requests to review.</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-warm-200 bg-warm-50">
                    {['Employee', 'Type', 'Dates', 'Reason', 'Status', 'Actions'].map((h) => (
                      <th
                        key={h}
                        className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-warm-200">
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-warm-50 transition-colors">
                      <td className="px-4 py-3 text-sm">
                        <p className="font-medium text-warm-900">{name(r)}</p>
                        <p className="text-xs text-warm-500">{r.employee?.employeeCode}</p>
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        {TYPE_LABEL[r.type]}
                        {r.location && <p className="text-xs text-warm-500">{r.location}</p>}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap">
                        {formatDate(r.fromDate)}
                        {dayPart(r.fromDate) !== dayPart(r.toDate) &&
                          ` – ${formatDate(r.toDate)}`}{' '}
                        <span className="text-warm-500">
                          ({r.days} day{r.days === 1 ? '' : 's'})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-warm-600 max-w-xs truncate">
                        {r.reason}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={getStatusBadgeVariant(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() => open(r, 'approve')}
                          className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Approve"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => open(r, 'reject')}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Reject"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      <Modal
        isOpen={!!reviewing}
        onClose={() => setReviewing(null)}
        title={action === 'approve' ? 'Approve request' : 'Reject request'}
        size="md"
      >
        {reviewing && (
          <div className="space-y-4">
            <div className="bg-warm-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-warm-500">Employee</span>
                <span className="font-medium">{name(reviewing)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-warm-500">Request</span>
                <span className="font-medium">{TYPE_LABEL[reviewing.type]}</span>
              </div>
              <div className="pt-2 border-t">
                <p className="text-warm-500">Reason</p>
                <p className="text-warm-900 mt-1">{reviewing.reason}</p>
              </div>
            </div>
            <div>
              <label htmlFor="decision-note" className="block text-sm font-medium text-warm-700 mb-1">
                Note (optional)
              </label>
              <textarea
                id="decision-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
              />
            </div>
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setReviewing(null)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={action === 'approve' ? 'primary' : 'danger'}
            onClick={decide}
            loading={saving}
          >
            {action === 'approve' ? 'Confirm approval' : 'Confirm rejection'}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
