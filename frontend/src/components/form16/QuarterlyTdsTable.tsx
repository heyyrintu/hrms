'use client';

import type { Form16Quarter } from '@/types';
import { formatINR } from './money';

interface QuarterlyTdsTableProps {
  quarters: Form16Quarter[];
  /** Totals from the quarterly summary, when it was fetched. */
  totalAmountPaid?: string | null;
  totalTaxDeducted?: string | null;
}

/**
 * Q1 to Q4 as payroll deducted them.
 *
 * The TRACES receipt column is always empty — the receipt number exists only
 * once a Form 24Q return has been accepted — and it is shown rather than hidden
 * because its emptiness is the point.
 */
export function QuarterlyTdsTable({
  quarters,
  totalAmountPaid,
  totalTaxDeducted,
}: QuarterlyTdsTableProps) {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-warm-900">Quarterly tax deducted at source</h2>
        <p className="text-sm text-warm-600 mt-1">
          These quarters are what payroll deducted, not what has been reported in a filed return.
          Reconcile every figure against the Form 24Q returns and the challans actually paid before
          this certificate is issued to an employee.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-warm-200 text-left text-xs uppercase tracking-wide text-warm-500">
              <th className="py-2 pr-4 font-semibold">Quarter</th>
              <th className="py-2 pr-4 font-semibold">Months</th>
              <th className="py-2 pr-4 font-semibold text-right">Amount paid</th>
              <th className="py-2 pr-4 font-semibold text-right">Tax deducted</th>
              <th className="py-2 font-semibold">TRACES receipt number</th>
            </tr>
          </thead>
          <tbody>
            {quarters.map((quarter) => (
              <tr key={quarter.quarter} className="border-b border-warm-100">
                <td className="py-2.5 pr-4 font-semibold text-warm-900">{quarter.quarter}</td>
                <td className="py-2.5 pr-4 text-warm-600">{quarter.months.join(', ')}</td>
                <td className="py-2.5 pr-4 text-right font-medium text-warm-900">
                  {formatINR(quarter.amountPaid)}
                </td>
                <td className="py-2.5 pr-4 text-right font-medium text-warm-900">
                  {formatINR(quarter.taxDeducted)}
                </td>
                <td className="py-2.5">
                  <span className="text-xs italic text-warm-400">Issued by TRACES</span>
                </td>
              </tr>
            ))}
            {totalAmountPaid && totalTaxDeducted ? (
              <tr className="font-semibold text-warm-900">
                <td className="py-2.5 pr-4" colSpan={2}>
                  Total for the year
                </td>
                <td className="py-2.5 pr-4 text-right">{formatINR(totalAmountPaid)}</td>
                <td className="py-2.5 pr-4 text-right">{formatINR(totalTaxDeducted)}</td>
                <td className="py-2.5" />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
