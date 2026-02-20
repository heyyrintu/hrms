'use client';

import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmployeeSalary } from '@/types';
import { formatCurrency, formatSalaryDate } from '@/lib/salaryCalculations';
import { cn } from '@/lib/utils';

interface SalaryHistoryTableProps {
  history: EmployeeSalary[];
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function SalaryHistoryTable({
  history,
  loading,
  emptyMessage = 'No salary history found',
  className,
}: SalaryHistoryTableProps) {
  if (loading) {
    return (
      <div className={cn('flex items-center justify-center py-8', className)}>
        <Spinner />
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className={cn('text-center py-8 text-warm-500', className)}>
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-warm-200 bg-warm-50">
            <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
              Structure
            </th>
            <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">
              Base Pay
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
              Effective From
            </th>
            <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
              Effective To
            </th>
            <th className="text-center px-4 py-3 text-xs font-medium text-warm-500 uppercase">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-warm-200">
          {history.map((record) => (
            <tr key={record.id} className="hover:bg-warm-50 transition-colors">
              <td className="px-4 py-3 text-sm font-medium text-warm-900">
                {record.salaryStructure?.name || 'N/A'}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-warm-900 text-right">
                {formatCurrency(Number(record.basePay))}
              </td>
              <td className="px-4 py-3 text-sm text-warm-600">
                {formatSalaryDate(record.effectiveFrom)}
              </td>
              <td className="px-4 py-3 text-sm text-warm-600">
                {record.effectiveTo ? formatSalaryDate(record.effectiveTo) : 'Present'}
              </td>
              <td className="px-4 py-3 text-center">
                <Badge variant={record.isActive ? 'success' : 'gray'}>
                  {record.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
