'use client';

import { Badge } from '@/components/ui/Badge';
import { Award, AlertCircle } from 'lucide-react';
import type { SettlementGratuityBreakdown } from '@/types';
import { formatMoney } from './format';

interface GratuityWorkingProps {
  gratuity: SettlementGratuityBreakdown;
}

/**
 * The gratuity working, laid out so an exiting employee can check the
 * arithmetic rather than take a single number on trust.
 *
 * Two things this is careful about:
 *
 * - When gratuity is not payable it shows *why*. A bare zero next to
 *   "Gratuity" reads as an error or an oversight; the reason is the answer to
 *   the question the leaver is about to ask.
 * - Exempt and taxable parts are shown separately. Section 10(10) caps the
 *   *exemption*, not the entitlement: gratuity above the ceiling is still
 *   payable in full, and collapsing the two into one figure would suggest
 *   otherwise.
 */
export function GratuityWorking({ gratuity }: GratuityWorkingProps) {
  return (
    <div
      data-testid="gratuity-working"
      className="rounded-lg border border-warm-200 bg-white"
    >
      <div className="flex items-center justify-between gap-3 border-b border-warm-200 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-warm-900">
          <Award className="w-4 h-4 text-primary-600" />
          Gratuity
        </h3>
        {gratuity.eligible ? (
          <Badge variant="success">Eligible</Badge>
        ) : (
          <Badge variant="gray">Not eligible</Badge>
        )}
      </div>

      {!gratuity.eligible ? (
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3">
            <AlertCircle className="mt-0.5 w-4 h-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-900">
              {gratuity.ineligibleReason ??
                'No reason was recorded for this settlement. Recompute it to find out why gratuity is not payable.'}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-warm-500">Continuous service</dt>
              <dd className="font-medium text-warm-900">
                <span>{gratuity.serviceYears}</span> years
              </dd>
            </div>
            <div>
              <dt className="text-warm-500">Gratuity payable</dt>
              <dd className="font-medium text-warm-900">{formatMoney(gratuity.amount)}</dd>
            </div>
          </dl>
          <p className="text-xs text-warm-500">
            The Payment of Gratuity Act 1972 requires five years of continuous service,
            except on death or permanent disablement.
          </p>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-warm-500">Continuous service</dt>
              <dd className="font-medium text-warm-900">
                <span>{gratuity.serviceYears}</span> years
              </dd>
            </div>
            <div>
              <dt className="text-warm-500">Years counted</dt>
              <dd className="font-medium text-warm-900">
                <span>{gratuity.countedYears}</span> years
              </dd>
            </div>
            <div>
              <dt className="text-warm-500">Gratuity payable</dt>
              <dd className="font-semibold text-warm-900">{formatMoney(gratuity.amount)}</dd>
            </div>
            <div>
              <dt className="text-warm-500">Exempt under s.10(10)</dt>
              <dd className="font-medium text-emerald-700">
                {formatMoney(gratuity.exemptAmount)}
              </dd>
            </div>
            <div>
              <dt className="text-warm-500">Taxable balance</dt>
              <dd className="font-medium text-warm-900">
                {formatMoney(gratuity.taxableAmount)}
              </dd>
            </div>
          </dl>

          <div className="space-y-2 border-t border-warm-100 pt-3 text-xs text-warm-500">
            <p>
              Years counted round up: a part-year over six months counts as a full year
              under the Payment of Gratuity Act 1972, which is why {gratuity.serviceYears}{' '}
              years of service is counted as {gratuity.countedYears}.
            </p>
            <p>
              Gratuity above the section 10(10) ceiling is payable in full; only the
              exemption is capped. The taxable balance above is the part of the same
              amount that is not exempt, not an amount withheld.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
