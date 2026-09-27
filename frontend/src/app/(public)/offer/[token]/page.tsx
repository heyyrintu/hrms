'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { publicOfferApi, type PublicOffer } from '@/lib/api-careers';
import {
  apiErrorMessage,
  formatDateTime,
  formatDay,
  formatInr,
  offerContentToText,
} from '@/components/recruitment/offers/offerFormat';

const INVALID_LINK = 'This offer link is invalid or has expired';

type Mode = 'view' | 'accept' | 'decline';

/**
 * Public offer page: the candidate reads the letter and accepts (typing their
 * full name) or declines. The token in the URL is the only credential, so
 * nothing on this page may send it elsewhere: the logo is loaded with
 * `no-referrer`, and the letter is rendered as plain text, never as markup.
 */
export default function PublicOfferPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token as string) ?? '';

  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [mode, setMode] = useState<Mode>('view');
  const [acceptedName, setAcceptedName] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setLoadError(false);
    try {
      const res = await publicOfferApi.get(token);
      setOffer(res.data);
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) setNotFound(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedName.trim()) {
      setFormError('Type your full name to accept');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await publicOfferApi.accept(token, acceptedName.trim());
      setOffer(res.data);
      setMode('view');
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) setNotFound(true);
      else if (status === 429) setFormError('Too many attempts. Please wait a minute and try again.');
      else setFormError(apiErrorMessage(error, 'Could not accept the offer. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const decline = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await publicOfferApi.decline(token, reason.trim() || undefined);
      setOffer(res.data);
      setMode('view');
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) setNotFound(true);
      else if (status === 429) setFormError('Too many attempts. Please wait a minute and try again.');
      else setFormError(apiErrorMessage(error, 'Could not decline the offer. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p className="text-center text-sm text-warm-500">Loading your offer…</p>;
  }
  if (notFound) {
    return (
      <div className="rounded-xl border border-warm-200 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-warm-900">{INVALID_LINK}</h1>
        <p className="mt-2 text-sm text-warm-600">
          Please contact the company&apos;s HR team if you think this is a mistake.
        </p>
      </div>
    );
  }
  if (loadError || !offer) {
    return (
      <div className="rounded-xl border border-warm-200 bg-white p-8 text-center">
        <p className="text-sm text-red-600">We could not load your offer right now.</p>
        <button type="button" onClick={load} className="btn btn-secondary btn-sm mt-3">
          Try again
        </button>
      </div>
    );
  }

  const open = offer.status === 'SENT';

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        {offer.company.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={offer.company.logoUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-12 w-12 rounded object-contain"
          />
        )}
        <div>
          <p className="text-sm text-warm-500">{offer.company.name}</p>
          <h1 className="text-2xl font-semibold text-warm-900">
            Hi {offer.candidateFirstName}, your offer for {offer.jobTitle}
          </h1>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-warm-200 bg-white p-5 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-warm-500">Annual CTC</p>
          <p className="text-lg font-semibold text-warm-900">{formatInr(offer.annualCtc)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-warm-500">Joining date</p>
          <p className="text-lg font-semibold text-warm-900">{formatDay(offer.joiningDate)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-warm-500">Respond by</p>
          <p className="text-lg font-semibold text-warm-900">{offer.expiresAt ? formatDateTime(offer.expiresAt) : '—'}</p>
        </div>
      </section>

      <article
        className="whitespace-pre-wrap rounded-xl border border-warm-200 bg-white p-6 text-sm leading-relaxed text-warm-800"
        aria-label="Offer letter"
      >
        {offerContentToText(offer.content)}
      </article>

      {offer.status === 'ACCEPTED' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800" role="status">
          You accepted this offer{offer.respondedAt ? ` on ${formatDateTime(offer.respondedAt)}` : ''}. The HR team
          will be in touch about your joining.
        </div>
      )}
      {offer.status === 'DECLINED' && (
        <div className="rounded-xl border border-warm-200 bg-warm-50 p-5 text-warm-700" role="status">
          You declined this offer{offer.respondedAt ? ` on ${formatDateTime(offer.respondedAt)}` : ''}. Thank you for
          letting us know.
        </div>
      )}
      {offer.status === 'WITHDRAWN' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-800" role="status">
          This offer has been withdrawn by {offer.company.name}.
        </div>
      )}
      {!open && !['ACCEPTED', 'DECLINED', 'WITHDRAWN'].includes(offer.status) && (
        <div className="rounded-xl border border-warm-200 bg-warm-50 p-5 text-warm-700" role="status">
          This offer is no longer available.
        </div>
      )}

      {open && mode === 'view' && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="button" className="btn btn-primary btn-md" onClick={() => setMode('accept')}>
            Accept offer
          </button>
          <button type="button" className="btn btn-secondary btn-md" onClick={() => setMode('decline')}>
            Decline
          </button>
        </div>
      )}

      {open && mode === 'accept' && (
        <form onSubmit={accept} className="space-y-3 rounded-xl border border-warm-200 bg-white p-5">
          <label htmlFor="accepted-name" className="label">
            Type your full name to accept this offer
          </label>
          <input
            id="accepted-name"
            className="input"
            value={acceptedName}
            maxLength={200}
            autoComplete="name"
            onChange={(e) => setAcceptedName(e.target.value)}
          />
          <p className="text-xs text-warm-500">
            Your typed name, the time, and your IP address are recorded as your acceptance.
          </p>
          {formError && (
            <p className="text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-md" disabled={submitting}>
              {submitting ? 'Accepting…' : 'I accept'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-md"
              onClick={() => {
                setMode('view');
                setFormError(null);
              }}
            >
              Back
            </button>
          </div>
        </form>
      )}

      {open && mode === 'decline' && (
        <form onSubmit={decline} className="space-y-3 rounded-xl border border-warm-200 bg-white p-5">
          <label htmlFor="decline-reason" className="label">
            Reason (optional)
          </label>
          <textarea
            id="decline-reason"
            className="input min-h-[96px]"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
          {formError && (
            <p className="text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-danger btn-md" disabled={submitting}>
              {submitting ? 'Declining…' : 'Decline offer'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-md"
              onClick={() => {
                setMode('view');
                setFormError(null);
              }}
            >
              Back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
