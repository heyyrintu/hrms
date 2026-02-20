'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CurrentSalaryCard } from './CurrentSalaryCard';
import { SalaryHistoryTable } from './SalaryHistoryTable';
import { AssignSalaryModal } from './AssignSalaryModal';
import { EmployeeSalary } from '@/types';
import { payrollApi } from '@/lib/api';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface EmployeeSalarySectionProps {
  employeeId: string;
  employeeName?: string;
  canEdit?: boolean;
  onValidationChange?: (isValid: boolean) => void;
  className?: string;
}

export function EmployeeSalarySection({
  employeeId,
  employeeName = 'Employee',
  canEdit = false,
  onValidationChange,
  className,
}: EmployeeSalarySectionProps) {
  const [currentSalary, setCurrentSalary] = useState<EmployeeSalary | null>(null);
  const [salaryHistory, setSalaryHistory] = useState<EmployeeSalary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSalaryData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await payrollApi.getEmployeeSalary(employeeId);
      const salaries = response.data || [];

      // Separate current active salary from history
      const active = salaries.find(
        (s: EmployeeSalary) => s.isActive
      );
      const history = salaries.sort(
        (a: EmployeeSalary, b: EmployeeSalary) =>
          new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()
      );

      setCurrentSalary(active || null);
      setSalaryHistory(history);
    } catch (err: any) {
      const message = err.response?.data?.message || 'Failed to load salary information';
      setError(message);
      toast.error(message);
      console.error('Failed to load salary data:', err);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    if (employeeId) {
      loadSalaryData();
    }
  }, [employeeId, loadSalaryData]);

  useEffect(() => {
    // Notify parent about validation state
    if (onValidationChange) {
      // At least one active salary should exist for validation
      const isValid = currentSalary !== null;
      onValidationChange(isValid);
    }
  }, [currentSalary, onValidationChange]);

  const handleAssignSuccess = () => {
    loadSalaryData();
  };

  const handleOpenModal = () => {
    setModalOpen(true);
  };

  if (error && !loading) {
    return (
      <div className={cn('space-y-4', className)}>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-primary-600">
              <p className="font-medium">Error loading salary information</p>
              <p className="text-sm mt-1">{error}</p>
              <Button onClick={loadSalaryData} className="mt-4" variant="secondary" size="sm">
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Current Salary Card */}
      <CurrentSalaryCard
        salary={currentSalary}
        loading={loading}
        onChangeClick={handleOpenModal}
        canEdit={canEdit}
      />

      {/* Salary History */}
      {(salaryHistory.length > 0 || !loading) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Salary History</CardTitle>
              {canEdit && (
                <Button onClick={handleOpenModal} size="sm" variant="secondary">
                  <Plus className="w-4 h-4 mr-2" />
                  Assign New Salary
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <SalaryHistoryTable
              history={salaryHistory}
              loading={loading}
              emptyMessage="No salary assignments yet"
            />
          </CardContent>
        </Card>
      )}

      {/* Assign Salary Modal */}
      {canEdit && (
        <AssignSalaryModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          employeeId={employeeId}
          employeeName={employeeName}
          onSuccess={handleAssignSuccess}
        />
      )}
    </div>
  );
}
