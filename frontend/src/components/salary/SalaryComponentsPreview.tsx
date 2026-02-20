'use client';

import { useMemo } from 'react';
import { SalaryComponent } from '@/types';
import { calculateSalaryBreakdown, formatCurrency } from '@/lib/salaryCalculations';
import { cn } from '@/lib/utils';

interface SalaryComponentsPreviewProps {
  basePay: number;
  components: SalaryComponent[];
  className?: string;
}

export function SalaryComponentsPreview({
  basePay,
  components,
  className,
}: SalaryComponentsPreviewProps) {
  const breakdown = useMemo(
    () => calculateSalaryBreakdown(basePay, components),
    [basePay, components]
  );

  if (basePay <= 0) {
    return (
      <div className={cn('text-center py-4 text-warm-500 text-sm', className)}>
        Enter base pay to see breakdown
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Earnings */}
      <div>
        <p className="text-xs font-medium text-warm-500 uppercase mb-2">Earnings</p>
        <div className="space-y-1">
          {breakdown.earnings.map((earning, index) => (
            <div key={index} className="flex justify-between text-sm">
              <span className="text-warm-700">{earning.name}</span>
              <span className="font-medium text-emerald-600">
                {formatCurrency(earning.amount)}
              </span>
            </div>
          ))}
          <div className="flex justify-between text-sm font-semibold pt-1 border-t border-warm-200">
            <span>Gross Pay</span>
            <span className="text-emerald-600">{formatCurrency(breakdown.grossPay)}</span>
          </div>
        </div>
      </div>

      {/* Deductions */}
      {breakdown.deductions.length > 0 && (
        <div>
          <p className="text-xs font-medium text-warm-500 uppercase mb-2">Deductions</p>
          <div className="space-y-1">
            {breakdown.deductions.map((deduction, index) => (
              <div key={index} className="flex justify-between text-sm">
                <span className="text-warm-700">{deduction.name}</span>
                <span className="font-medium text-red-600">
                  -{formatCurrency(deduction.amount)}
                </span>
              </div>
            ))}
            <div className="flex justify-between text-sm font-semibold pt-1 border-t border-warm-200">
              <span>Total Deductions</span>
              <span className="text-red-600">
                -{formatCurrency(breakdown.totalDeductions)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Net Pay */}
      <div className="pt-2 border-t-2 border-warm-300">
        <div className="flex justify-between items-center">
          <span className="text-base font-semibold text-warm-900">Net Pay</span>
          <span className="text-xl font-bold text-primary-600">
            {formatCurrency(breakdown.netPay)}
          </span>
        </div>
        <p className="text-xs text-warm-500 mt-1 text-right">
          Annual: {formatCurrency(breakdown.grossPay * 12)}
        </p>
      </div>
    </div>
  );
}
