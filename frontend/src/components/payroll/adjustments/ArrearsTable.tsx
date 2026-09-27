'use client';

import { Fragment, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/salaryCalculations';
import type { SalaryArrear } from '@/lib/api-payroll-depth';
import { ArrearStatusBadge } from './HoldStatusBadge';
import { MONTH_SHORT, employeeName, formatRunLabel } from './shared';

interface Props {
  arrears: SalaryArrear[];
  /** Shown for PENDING rows when given. */
  onCancel?: (arrear: SalaryArrear) => void;
  showRun?: boolean;
}

/** "FY 2025-26" for the financial year starting in April 2025. */
export function formatFinancialYear(fy: number): string {
  return `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
}

/**
 * Salary arrears with their per-component lines (expandable). A negative
 * amount is a recovery from the employee.
 */
export function ArrearsTable({ arrears, onCancel, showRun = true }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const colSpan = 8 + (showRun ? 1 : 0) + (onCancel ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-warm-200 bg-warm-50 text-xs uppercase text-warm-600">
            <th className="px-3 py-2 w-8" />
            <th className="px-3 py-2 text-left">Employee</th>
            <th className="px-3 py-2 text-left">For</th>
            <th className="px-3 py-2 text-left">FY</th>
            <th className="px-3 py-2 text-right">Original</th>
            <th className="px-3 py-2 text-right">Revised</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-left">Status</th>
            {showRun && <th className="px-3 py-2 text-left">Run</th>}
            {onCancel && <th className="px-3 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-warm-100">
          {arrears.map((a) => {
            const open = expanded.has(a.id);
            const recovery = a.amount < 0;
            return (
              <Fragment key={a.id}>
                <tr>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggle(a.id)}
                      aria-expanded={open}
                      aria-label={`${open ? 'Hide' : 'Show'} components for ${employeeName(a.employee)} ${MONTH_SHORT[a.forMonth]} ${a.forYear}`}
                      className="text-warm-500 hover:text-warm-800"
                    >
                      {open ? '▾' : '▸'}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    {employeeName(a.employee)}
                    <span className="block text-xs text-warm-500">{a.employee.employeeCode}</span>
                  </td>
                  <td className="px-3 py-2">{MONTH_SHORT[a.forMonth]} {a.forYear}</td>
                  <td className="px-3 py-2">{formatFinancialYear(a.financialYear)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(a.originalAmount)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(a.revisedAmount)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${recovery ? 'text-red-600' : 'text-emerald-700'}`}>
                    {recovery ? `−${formatCurrency(Math.abs(a.amount))}` : formatCurrency(a.amount)}
                    {recovery && <span className="block text-xs font-normal">Recovery</span>}
                  </td>
                  <td className="px-3 py-2"><ArrearStatusBadge status={a.status} /></td>
                  {showRun && <td className="px-3 py-2">{a.payrollRun ? formatRunLabel(a.payrollRun) : '-'}</td>}
                  {onCancel && (
                    <td className="px-3 py-2 text-right">
                      {a.status === 'PENDING' && (
                        <Button size="sm" variant="secondary" onClick={() => onCancel(a)}>Cancel</Button>
                      )}
                    </td>
                  )}
                </tr>
                {open && (
                  <tr className="bg-warm-50">
                    <td colSpan={colSpan} className="px-6 py-2">
                      {a.lines.length === 0 ? (
                        <p className="text-xs text-warm-500">No component detail.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-warm-500">
                              <th className="py-1 text-left">Component</th>
                              <th className="py-1 text-right">Original</th>
                              <th className="py-1 text-right">Revised</th>
                              <th className="py-1 text-right">Difference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.lines.map((l) => (
                              <tr key={l.name}>
                                <td className="py-1">{l.name}</td>
                                <td className="py-1 text-right">{formatCurrency(l.original)}</td>
                                <td className="py-1 text-right">{formatCurrency(l.revised)}</td>
                                <td className="py-1 text-right">
                                  {l.delta < 0 ? `−${formatCurrency(Math.abs(l.delta))}` : formatCurrency(l.delta)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
