'use client';

/**
 * What happens to this employee's tax if they submit nothing.
 *
 * Three genuinely different situations, and conflating any two of them tells
 * somebody a falsehood about their own salary:
 *
 *  - Verified amounts are in force. A head with nothing approved allows
 *    nothing, and more tax comes out of this month's salary because of it.
 *  - The employer requires verification but the cutoff has not arrived. The
 *    declared figure still stands, and there is a date by which that changes.
 *  - The employer has not switched verification on at all. There is no date.
 *    Inventing one to add urgency would be a lie about their employer's policy.
 *
 * A fourth case is honest ignorance: the tenant's setting could not be read, so
 * the page says only what the summary itself establishes and names no date.
 */

import { AlertTriangle, CalendarClock, Info } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/Card';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** The cutoff month by name, or null when it is not a month. */
function monthName(month: number): string | null {
  return MONTH_NAMES[month - 1] ?? null;
}

export interface VerificationNoticeProps {
  /** Whether verified amounts are in force for this tenant and month. */
  verificationInForce: boolean;
  /** The calendar month from which they take over, 1 to 12. */
  cutoffMonth: number;
  /**
   * Whether the employer requires verification at all. Null when the tenant's
   * configuration could not be read, which is not the same as "no".
   */
  verificationEnabled: boolean | null;
}

export function VerificationNotice({
  verificationInForce,
  cutoffMonth,
  verificationEnabled,
}: VerificationNoticeProps) {
  if (verificationInForce) {
    return (
      <div data-testid="verification-notice">
        <Card className="border-amber-200 bg-amber-50">
        <CardContent className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="space-y-1.5 text-sm text-amber-900">
            <p className="font-semibold">Only approved amounts count towards your tax now.</p>
            <p>
              Any head below with nothing approved allows nothing, so more tax is deducted from
              your salary than your declaration alone would suggest. That reverses for a head as
              soon as evidence for it is approved.
            </p>
          </div>
        </CardContent>
        </Card>
      </div>
    );
  }

  const cutoff = monthName(cutoffMonth);

  if (verificationEnabled === true && cutoff) {
    return (
      <div data-testid="verification-notice">
        <Card className="border-sky-200 bg-sky-50">
        <CardContent className="flex gap-3">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" aria-hidden="true" />
          <div className="space-y-1.5 text-sm text-sky-900">
            <p className="font-semibold">Your declared figures still stand for now.</p>
            <p>
              Tax is being deducted on what you declared. From {cutoff}, only the amounts approved
              from your evidence count, so a head with nothing approved by then will allow nothing
              and more tax will come out of your salary.
            </p>
          </div>
        </CardContent>
        </Card>
      </div>
    );
  }

  if (verificationEnabled === false) {
    return (
      <div data-testid="verification-notice">
        <Card className="border-warm-300 bg-warm-50">
        <CardContent className="flex gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-warm-500" aria-hidden="true" />
          <div className="space-y-1.5 text-sm text-warm-700">
            <p className="font-semibold">Your declared figures stand as declared.</p>
            <p>
              Your employer has not switched on proof verification, so there is no date here by
              which evidence has to be approved. Documents you submit are still reviewed and kept
              on your record.
            </p>
          </div>
        </CardContent>
        </Card>
      </div>
    );
  }

  // Either the setting could not be read, or the cutoff is not a month we can
  // name. Say what the summary establishes and no more.
  return (
    <div data-testid="verification-notice">
        <Card className="border-warm-300 bg-warm-50">
      <CardContent className="flex gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-warm-500" aria-hidden="true" />
        <div className="space-y-1.5 text-sm text-warm-700">
          <p className="font-semibold">Your declared figures still stand for now.</p>
          <p>
            Approved amounts are not in force this month, so tax is being deducted on what you
            declared. Whether and when that changes is not shown here — ask payroll.
          </p>
        </div>
      </CardContent>
      </Card>
    </div>
  );
}
