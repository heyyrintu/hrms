'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { recruitmentApi, type Offer } from '@/lib/api-recruitment';
import { OfferFormModal } from './OfferFormModal';
import { ConvertOfferModal } from './ConvertOfferModal';
import {
  LIVE_OFFER_STATUSES,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_VARIANTS,
  apiErrorMessage,
  formatDateTime,
  formatDay,
  formatInr,
  offerContentToText,
} from './offerFormat';

interface TimelineStep {
  label: string;
  at: string | null;
  detail?: string | null;
  tone: 'done' | 'bad' | 'pending';
}

/** The offer's history, derived from its timestamps and status. */
export function offerTimeline(offer: Offer): TimelineStep[] {
  const steps: TimelineStep[] = [{ label: 'Drafted', at: offer.createdAt, tone: 'done' }];
  const s = offer.status;
  if (s === 'PENDING_APPROVAL') steps.push({ label: 'Awaiting approval', at: null, tone: 'pending' });
  if (s === 'REJECTED') {
    steps.push({ label: 'Rejected by approver', at: null, detail: offer.decisionNote, tone: 'bad' });
  }
  if (['APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'].includes(s) || (s === 'WITHDRAWN' && offer.sentAt)) {
    steps.push({ label: 'Approved', at: null, detail: offer.decisionNote, tone: 'done' });
  }
  if (offer.sentAt) {
    steps.push({
      label: 'Sent to candidate',
      at: offer.sentAt,
      detail: offer.expiresAt ? `Respond by ${formatDateTime(offer.expiresAt)}` : null,
      tone: 'done',
    });
  }
  if (s === 'ACCEPTED') {
    steps.push({
      label: 'Accepted',
      at: offer.respondedAt,
      detail: offer.acceptedName ? `Signed as “${offer.acceptedName}”` : null,
      tone: 'done',
    });
  }
  if (s === 'DECLINED') steps.push({ label: 'Declined', at: offer.respondedAt, detail: offer.declineReason, tone: 'bad' });
  if (s === 'EXPIRED') steps.push({ label: 'Expired without an answer', at: offer.expiresAt, tone: 'bad' });
  if (s === 'WITHDRAWN') steps.push({ label: 'Withdrawn', at: null, tone: 'bad' });
  if (offer.convertedAt) steps.push({ label: 'Converted to employee', at: offer.convertedAt, tone: 'done' });
  return steps;
}

const toneClass: Record<TimelineStep['tone'], string> = {
  done: 'bg-emerald-500',
  bad: 'bg-red-500',
  pending: 'bg-amber-400',
};

function OfferTimeline({ offer }: { offer: Offer }) {
  return (
    <ol className="space-y-2" aria-label="Offer timeline">
      {offerTimeline(offer).map((step, i) => (
        <li key={`${step.label}-${i}`} className="flex items-start gap-2 text-sm">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${toneClass[step.tone]}`} aria-hidden />
          <div>
            <span className="font-medium text-warm-800">{step.label}</span>
            {step.at && <span className="ml-2 text-warm-500">{formatDateTime(step.at)}</span>}
            {step.detail && <p className="text-warm-600">{step.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

interface Props {
  applicationId: string;
  applicationActive: boolean;
  /** Called after any change that may move the application (send, convert). */
  onChanged?: () => void;
}

/** Offers of one application (HR only): draft → approve → send → answer → convert. */
export function OfferPanel({ applicationId, applicationActive, onChanged }: Props) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Offer | null>(null);
  const [converting, setConverting] = useState<Offer | null>(null);
  const [preview, setPreview] = useState<Offer | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await recruitmentApi.listOffers();
      setOffers((res.data ?? []).filter((o) => o.applicationId === applicationId));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    load();
  }, [load]);

  const hasLive = offers.some((o) => LIVE_OFFER_STATUSES.includes(o.status));

  const act = async (offer: Offer, action: 'submit' | 'send' | 'withdraw') => {
    if (action === 'withdraw' && !window.confirm('Withdraw this offer? The candidate can no longer accept it.')) return;
    setBusy(`${offer.id}:${action}`);
    try {
      if (action === 'submit') await recruitmentApi.submitOffer(offer.id);
      if (action === 'send') await recruitmentApi.sendOffer(offer.id);
      if (action === 'withdraw') await recruitmentApi.withdrawOffer(offer.id);
      toast.success(
        action === 'submit' ? 'Submitted for approval' : action === 'send' ? 'Offer e-mailed to the candidate' : 'Offer withdrawn',
      );
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Action failed'));
    } finally {
      setBusy(null);
    }
  };

  const downloadPdf = async (offer: Offer) => {
    try {
      const res = await recruitmentApi.offerPdf(offer.id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `offer-${offer.candidate.firstName}-${offer.candidate.lastName}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to download the PDF');
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-warm-900">Offers</h2>
          {applicationActive && !hasLive && !loading && !error && (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Draft offer
            </Button>
          )}
        </div>

        {loading && <p className="text-sm text-warm-500">Loading offers…</p>}
        {error && (
          <div className="flex items-center gap-3 text-sm text-red-600">
            Failed to load offers.
            <Button size="sm" variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        )}
        {!loading && !error && offers.length === 0 && (
          <p className="text-sm text-warm-500">No offer yet.</p>
        )}

        {offers.map((offer) => (
          <div key={offer.id} className="space-y-3 rounded-lg border border-warm-200 p-4" data-testid={`offer-${offer.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant={OFFER_STATUS_VARIANTS[offer.status]}>{OFFER_STATUS_LABELS[offer.status]}</Badge>
                <span className="font-semibold text-warm-900">{formatInr(offer.annualCtc)} / year</span>
              </div>
              <span className="text-sm text-warm-500">
                Joining {formatDay(offer.joiningDate)} · {offer.template.name}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1 text-sm text-warm-600 sm:grid-cols-2">
              <span>Designation: {offer.designation?.name ?? '—'}</span>
              <span>Department: {offer.department?.name ?? '—'}</span>
              <span>
                Reporting to:{' '}
                {offer.reportingManager
                  ? `${offer.reportingManager.firstName} ${offer.reportingManager.lastName}`
                  : '—'}
              </span>
              <span>Base pay: {offer.monthlyBasePay != null ? `${formatInr(offer.monthlyBasePay)} / month` : '—'}</span>
            </div>

            <OfferTimeline offer={offer} />

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPreview(offer)}>
                View letter
              </Button>
              <Button size="sm" variant="ghost" onClick={() => downloadPdf(offer)}>
                PDF
              </Button>
              {(offer.status === 'DRAFT' || offer.status === 'REJECTED') && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditing(offer);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="sm" loading={busy === `${offer.id}:submit`} onClick={() => act(offer, 'submit')}>
                    Submit for approval
                  </Button>
                </>
              )}
              {offer.status === 'PENDING_APPROVAL' && (
                <Link href="/approvals" className="btn btn-secondary btn-sm">
                  Review in approvals
                </Link>
              )}
              {offer.status === 'APPROVED' && (
                <Button size="sm" loading={busy === `${offer.id}:send`} onClick={() => act(offer, 'send')}>
                  Send to candidate
                </Button>
              )}
              {offer.status === 'ACCEPTED' && !offer.employeeId && (
                <Button size="sm" onClick={() => setConverting(offer)}>
                  Convert to employee
                </Button>
              )}
              {offer.employeeId && (
                <Link href={`/employees/${offer.employeeId}`} className="btn btn-secondary btn-sm">
                  View employee
                </Link>
              )}
              {LIVE_OFFER_STATUSES.includes(offer.status) && (
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === `${offer.id}:withdraw`}
                  onClick={() => act(offer, 'withdraw')}
                >
                  Withdraw
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>

      <OfferFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        applicationId={applicationId}
        offer={editing}
        onSaved={() => {
          setFormOpen(false);
          load();
        }}
      />
      {converting && (
        <ConvertOfferModal
          isOpen={!!converting}
          onClose={() => setConverting(null)}
          offer={converting}
          onConverted={() => {
            setConverting(null);
            load();
            onChanged?.();
          }}
        />
      )}
      <Modal isOpen={!!preview} onClose={() => setPreview(null)} title="Offer letter" size="2xl">
        {preview && (
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-warm-800">
            {offerContentToText(preview.content)}
          </div>
        )}
      </Modal>
    </Card>
  );
}
