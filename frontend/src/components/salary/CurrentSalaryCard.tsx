'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { SalaryComponentsPreview } from './SalaryComponentsPreview';
import { EmployeeSalary } from '@/types';
import { formatCurrency, formatSalaryDate } from '@/lib/salaryCalculations';
import { DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CurrentSalaryCardProps {
  salary: EmployeeSalary | null;
  loading?: boolean;
  onChangeClick?: () => void;
  canEdit?: boolean;
  className?: string;
}

export function CurrentSalaryCard({
  salary,
  loading,
  onChangeClick,
  canEdit = false,
  className,
}: CurrentSalaryCardProps) {
  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Current Salary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Spinner />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!salary) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Current Salary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center text-warm-500">
            <DollarSign className="h-12 w-12 mx-auto mb-2 text-warm-300" />
            <p className="text-sm">No active salary assigned</p>
            {canEdit && onChangeClick && (
              <Button onClick={onChangeClick} className="mt-4" size="sm">
                Assign Salary
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Current Salary</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="success">Active</Badge>
            {canEdit && onChangeClick && (
              <Button onClick={onChangeClick} size="sm" variant="secondary">
                Change Salary
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Salary Info */}
        <div className="grid grid-cols-2 gap-4 mb-4 pb-4 border-b border-warm-200">
          <div>
            <p className="text-sm text-warm-500">Structure</p>
            <p className="font-medium text-warm-900 mt-1">
              {salary.salaryStructure?.name || 'N/A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-warm-500">Base Pay</p>
            <p className="text-2xl font-bold text-warm-900 mt-1">
              {formatCurrency(Number(salary.basePay))}
            </p>
          </div>
          <div>
            <p className="text-sm text-warm-500">Effective From</p>
            <p className="font-medium text-warm-900 mt-1">
              {formatSalaryDate(salary.effectiveFrom)}
            </p>
          </div>
          <div>
            <p className="text-sm text-warm-500">Effective To</p>
            <p className="font-medium text-warm-900 mt-1">
              {salary.effectiveTo ? formatSalaryDate(salary.effectiveTo) : 'Present'}
            </p>
          </div>
        </div>

        {/* Salary Breakdown */}
        {salary.salaryStructure?.components && (
          <div>
            <h4 className="text-sm font-semibold text-warm-900 mb-3">Salary Breakdown</h4>
            <SalaryComponentsPreview
              basePay={Number(salary.basePay)}
              components={salary.salaryStructure.components}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
