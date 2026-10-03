'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge, getStatusBadgeVariant } from '@/components/ui/Badge';
import {
  attendanceRequestsApi,
  type AttendanceRequest,
  type AttendanceRequestType,
} from '@/lib/api-attendance-requests';
import { todayLocalIso } from '@/lib/date';
import { formatDate } from '@/lib/utils';
import { Home, RefreshCw, Send } from 'lucide-react';
import toast from 'react-hot-toast';

const TYPE_LABEL: Record<AttendanceRequestType, string> = {
  WFH: 'Work from home',
  ON_DUTY: 'On duty',
};

const dayPart = (iso: string) => iso.slice(0, 10);

/** PENDING can be withdrawn; APPROVED only while some of its days are still ahead. */
function canCancel(request: AttendanceRequest, today: string): boolean {
  if (request.status === 'PENDING') return true;
  return request.status === 'APPROVED' && dayPart(request.toDate) >= today;
}

export default function AttendanceRequestsPage() {
  const [requests, setRequests] = useState<AttendanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const [type, setType] = useState<AttendanceRequestType>('WFH');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [reason, setReason] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await attendanceRequestsApi.getMine();
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

  const handleSubmit = async () => {
    if (!fromDate || !toDate || !reason.trim()) {
      toast.error('Fill in the dates and a reason');
      return;
    }
    if (toDate < fromDate) {
      toast.error('The end date cannot be before the start date');
      return;
    }
    setSubmitting(true);
    try {
      await attendanceRequestsApi.create({
        type,
        fromDate,
        toDate,
        reason: reason.trim(),
        ...(type === 'ON_DUTY' && location.trim() ? { location: location.trim() } : {}),
      });
      toast.success('Request submitted');
      setFromDate('');
      setToDate('');
      setReason('');
      setLocation('');
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to submit the request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      await attendanceRequestsApi.cancel(id);
      toast.success('Request cancelled');
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to cancel the request');
    } finally {
      setCancellingId(null);
    }
  };

  const today = todayLocalIso();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
            <Home className="h-6 w-6 text-primary-600" />
            Work from home and on duty
          </h1>
          <p className="text-warm-500">
            An approved request lets you clock in from outside the office network and
            marks the day accordingly.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New request</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value as AttendanceRequestType)}
              options={[
                { value: 'WFH', label: TYPE_LABEL.WFH },
                { value: 'ON_DUTY', label: TYPE_LABEL.ON_DUTY },
              ]}
            />
            <Input
              label="From"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          {type === 'ON_DUTY' && (
            <Input
              label="Location"
              value={location}
              maxLength={200}
              placeholder="Client site, branch, event..."
              onChange={(e) => setLocation(e.target.value)}
            />
          )}
          <div>
            <label htmlFor="request-reason" className="label">
              Reason
            </label>
            <textarea
              id="request-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSubmit} loading={submitting}>
              <Send className="h-4 w-4 mr-2" />
              Submit request
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My requests</CardTitle>
        </CardHeader>
        {loading ? (
          <CardContent>
            <div className="flex items-center justify-center py-12">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
            </div>
          </CardContent>
        ) : loadError ? (
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-warm-700">Failed to load your requests</p>
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          </CardContent>
        ) : requests.length === 0 ? (
          <CardContent className="py-12 text-center">
            <p className="text-warm-700 font-medium">No requests yet</p>
            <p className="text-sm text-warm-500">Use the form above to raise one.</p>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-warm-200 bg-warm-50">
                  {['Type', 'Dates', 'Days', 'Reason', 'Status', ''].map((h) => (
                    <th
                      key={h || 'actions'}
                      className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-200">
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {TYPE_LABEL[r.type]}
                      {r.location && (
                        <p className="text-xs text-warm-500">{r.location}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {formatDate(r.fromDate)}
                      {dayPart(r.fromDate) !== dayPart(r.toDate) && ` – ${formatDate(r.toDate)}`}
                    </td>
                    <td className="px-4 py-3 text-sm">{r.days}</td>
                    <td className="px-4 py-3 text-sm text-warm-600 max-w-xs">
                      <span className="block truncate">{r.reason}</span>
                      {r.approverNote && (
                        <span className="block text-xs text-warm-500">Note: {r.approverNote}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={getStatusBadgeVariant(r.status)}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canCancel(r, today) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancel(r.id)}
                          loading={cancellingId === r.id}
                        >
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
