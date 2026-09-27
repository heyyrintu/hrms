'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { recruitmentApi, type JobOfferStatus, type Offer } from '@/lib/api-recruitment';
import {
  OFFER_STATUS_LABELS,
  OFFER_STATUS_VARIANTS,
  formatDateTime,
  formatDay,
  formatInr,
} from '@/components/recruitment/offers/offerFormat';

const FILTERS: Array<{ value: JobOfferStatus | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'SENT', label: 'Sent' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'WITHDRAWN', label: 'Withdrawn' },
  { value: 'REJECTED', label: 'Rejected' },
];

/** Every offer of the tenant by status (HR). Actions live on the application page. */
export default function OffersPage() {
  const { hasRole } = useAuth();
  const isHr = hasRole(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN);

  const [status, setStatus] = useState<JobOfferStatus | ''>('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!isHr) return;
    setLoading(true);
    setError(false);
    try {
      const res = await recruitmentApi.listOffers(status ? { status } : undefined);
      setOffers(res.data ?? []);
    } catch {
      setError(true);
      toast.error('Failed to load offers');
    } finally {
      setLoading(false);
    }
  }, [isHr, status]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isHr) {
    return <p className="p-6 text-sm text-warm-600">Only HR can view offers.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900">Offers</h1>
          <p className="text-sm text-warm-500">Draft, approve and send offers from each candidate&apos;s application.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          <RefreshCw className="mr-1 h-4 w-4" /> Refresh
        </Button>
      </div>

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
            <p className="p-6 text-sm text-warm-500">Loading offers…</p>
          ) : error ? (
            <div className="flex items-center gap-3 p-6 text-sm text-red-600">
              Could not load offers.
              <Button size="sm" variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          ) : offers.length === 0 ? (
            <p className="p-6 text-center text-sm text-warm-500">No offers{status ? ' with this status' : ' yet'}.</p>
          ) : (
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-warm-200 bg-warm-50 text-xs uppercase text-warm-500">
                <tr>
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Position</th>
                  <th className="px-4 py-3">Annual CTC</th>
                  <th className="px-4 py-3">Joining</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sent / respond by</th>
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className="border-b border-warm-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/recruitment/applications/${o.applicationId}`} className="font-medium text-primary-600 hover:underline">
                        {o.candidate.firstName} {o.candidate.lastName}
                      </Link>
                      <p className="text-xs text-warm-500">{o.candidate.email}</p>
                    </td>
                    <td className="px-4 py-3">{o.jobOpening.title}</td>
                    <td className="px-4 py-3">{formatInr(o.annualCtc)}</td>
                    <td className="px-4 py-3">{formatDay(o.joiningDate)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={OFFER_STATUS_VARIANTS[o.status]}>{OFFER_STATUS_LABELS[o.status]}</Badge>
                      {o.employeeId && <p className="mt-1 text-xs text-emerald-700">Converted</p>}
                    </td>
                    <td className="px-4 py-3 text-warm-600">
                      {o.sentAt ? formatDateTime(o.sentAt) : '—'}
                      {o.expiresAt && <p className="text-xs text-warm-500">by {formatDateTime(o.expiresAt)}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
