import type {
  InterviewMode,
  InterviewRecommendation,
  InterviewStatus,
  JobOfferStatus,
} from '@/lib/api-recruitment';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray';

export const OFFER_STATUS_LABELS: Record<JobOfferStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
};

export const OFFER_STATUS_VARIANTS: Record<JobOfferStatus, BadgeVariant> = {
  DRAFT: 'gray',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  SENT: 'default',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'gray',
  WITHDRAWN: 'gray',
};

export const LIVE_OFFER_STATUSES: JobOfferStatus[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'SENT',
];

export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  SCHEDULED: 'Scheduled',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

export const INTERVIEW_STATUS_VARIANTS: Record<InterviewStatus, BadgeVariant> = {
  SCHEDULED: 'info',
  COMPLETED: 'success',
  CANCELLED: 'gray',
  NO_SHOW: 'danger',
};

export const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  VIDEO: 'Video',
  IN_PERSON: 'In person',
  PHONE: 'Phone',
};

export const RECOMMENDATION_LABELS: Record<InterviewRecommendation, string> = {
  STRONG_HIRE: 'Strong hire',
  HIRE: 'Hire',
  NO_HIRE: 'No hire',
  STRONG_NO_HIRE: 'Strong no hire',
};

export const RECOMMENDATION_VARIANTS: Record<InterviewRecommendation, BadgeVariant> = {
  STRONG_HIRE: 'success',
  HIRE: 'success',
  NO_HIRE: 'danger',
  STRONG_NO_HIRE: 'danger',
};

/** ₹12,00,000 */
export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** "01 Apr 2026" for a YYYY-MM-DD or ISO value. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '—';
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : undefined,
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Letter HTML → plain text for display. Templates are HR-authored HTML; the
 * offer is shown as pre-wrapped text so nothing in it is ever interpreted as
 * markup. DOMParser builds an inert document (no scripts run, nothing loads).
 */
export function offerContentToText(content: string): string {
  const withBreaks = content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n');
  if (typeof DOMParser === 'undefined') {
    return withBreaks.replace(/<[^>]+>/g, '').trim();
  }
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

export function personName(p: { firstName: string; lastName: string } | null | undefined): string {
  return p ? `${p.firstName} ${p.lastName}`.trim() : '—';
}

/** API error message from an axios error, else the fallback. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
}
