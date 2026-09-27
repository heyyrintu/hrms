import type { EmploymentType } from '@/lib/api-recruitment';

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  PERMANENT: 'Full-time',
  CONTRACT: 'Contract',
  TEMPORARY: 'Temporary',
  INTERN: 'Internship',
};

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

/** "1-3 yrs", "2+ yrs" or "" when neither bound is set. */
export function formatExperience(min: number | null, max: number | null): string {
  if (min == null && max == null) return '';
  if (min != null && max != null) return `${min}-${max} yrs`;
  if (min != null) return `${min}+ yrs`;
  return `Up to ${max} yrs`;
}

/** ₹12,00,000 */
export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** API error message from an axios error, else the fallback. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message ? message : fallback;
}

/** True for a 404 axios error. */
export function isNotFound(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 404;
}
