'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { accrualApi } from '@/lib/api';
import { RefreshCw, Plus, Calculator, ChevronRight, Clock } from 'lucide-react';
import toast from 'react-hot-toast';

interface AccrualRun {
  id: string;
  month: number;
  year: number;
  fiscalYear: number;
  triggerType: string;
  status: string;
  totalEmployeesProcessed: number;
  totalAccrualsCreated: number;
  totalErrors: number;
  runByUserId: string | null;
  runAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  runByUser: { firstName: string; lastName: string } | null;
}

interface AccrualEntry {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  balanceBefore: number;
  accrualDays: number;
  balanceAfter: number;
  capApplied: boolean;
  accrualNote: string | null;
  employee: { firstName: string; lastName: string };
  leaveType: { name: string; code: string };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const STATUS_COLORS = {
  COMPLETED: 'text-green-600 bg-green-50',
  PENDING: 'text-yellow-600 bg-yellow-50',
  FAILED: 'text-red-600 bg-red-50',
  ROLLED_BACK: 'text-gray-600 bg-gray-50',
};

const TRIGGER_TYPE_LABELS = {
  CRON_JOB: 'Automatic',
  MANUAL_ADMIN: 'Manual',
  MANUAL_SYSTEM: 'System',
};

export default function AccrualHistoryPage() {
  const [runs, setRuns] = useState<AccrualRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculateModalOpen, setCalculateModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<AccrualRun | null>(null);
  const [entries, setEntries] = useState<AccrualEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [calculating, setCalculating] = useState(false);

  const currentDate = new Date();
  const [formData, setFormData] = useState({
    month: currentDate.getMonth() + 1,
    year: currentDate.getFullYear(),
  });

  useEffect(() => {
    loadRuns();
  }, []);

  const loadRuns = async () => {
    setLoading(true);
    try {
      const response = await accrualApi.getRuns({ limit: 100, sortOrder: 'desc' });
      setRuns(response.data.data || []);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to load accrual history');
    } finally {
      setLoading(false);
    }
  };

  const handleCalculate = async () => {
    setCalculating(true);
    try {
      const response = await accrualApi.triggerAccrual({
        month: formData.month,
        year: formData.year,
      });

      const result = response.data;
      toast.success(
        `Accrual completed! Processed ${result.totalEmployeesProcessed} employees, created ${result.totalAccrualsCreated} accruals`,
        { duration: 5000 }
      );

      setCalculateModalOpen(false);
      await loadRuns();
    } catch (error: any) {
      const message = error.response?.data?.message || 'Failed to calculate accrual';
      toast.error(message, { duration: 6000 });
    } finally {
      setCalculating(false);
    }
  };

  const handleViewDetails = async (run: AccrualRun) => {
    setSelectedRun(run);
    setDetailsModalOpen(true);
    setLoadingEntries(true);

    try {
      const response = await accrualApi.getRunEntries(run.id, { limit: 1000 });
      setEntries(response.data.data || []);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to load entries');
      setEntries([]);
    } finally {
      setLoadingEntries(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-7 h-7 text-primary-600" />
            Leave Accrual History
          </h1>
          <p className="text-gray-600 mt-1">
            View accrual runs and manually trigger calculations
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={loadRuns}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={() => setCalculateModalOpen(true)}>
            <Calculator className="w-4 h-4 mr-2" />
            Calculate Accrual
          </Button>
        </div>
      </div>

      {/* Runs Table */}
      <Card padding="none">
        {runs.length === 0 ? (
          <div className="p-12 text-center">
            <Clock className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No Accrual History
            </h3>
            <p className="text-gray-500 mb-4">
              Run your first accrual calculation to see history
            </p>
            <Button onClick={() => setCalculateModalOpen(true)}>
              <Calculator className="w-4 h-4 mr-2" />
              Calculate Accrual
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Period
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Fiscal Year
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Trigger
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Employees
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Accruals
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Errors
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Run At
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {MONTH_NAMES[run.month - 1]} {run.year}
                      </div>
                      {run.runByUser && (
                        <div className="text-xs text-gray-500">
                          by {run.runByUser.firstName} {run.runByUser.lastName}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-medium text-gray-900">
                        FY {run.fiscalYear}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-sm text-gray-600">
                        {TRIGGER_TYPE_LABELS[run.triggerType as keyof typeof TRIGGER_TYPE_LABELS] || run.triggerType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          STATUS_COLORS[run.status as keyof typeof STATUS_COLORS] || 'text-gray-600 bg-gray-50'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-semibold text-gray-900">
                        {run.totalEmployeesProcessed}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-semibold text-primary-600">
                        {run.totalAccrualsCreated}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {run.totalErrors > 0 ? (
                        <span className="font-semibold text-red-600">
                          {run.totalErrors}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-gray-900">
                        {new Date(run.runAt).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(run.runAt).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleViewDetails(run)}
                        className="text-primary-600 hover:text-primary-800 inline-flex items-center gap-1 text-sm"
                      >
                        View Details
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Calculate Modal */}
      <Modal
        isOpen={calculateModalOpen}
        onClose={() => setCalculateModalOpen(false)}
        title="Calculate Leave Accrual"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            This will calculate and apply leave accruals for all active employees based on the
            configured accrual rules for the selected month.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Month *
              </label>
              <select
                value={formData.month}
                onChange={(e) =>
                  setFormData({ ...formData, month: Number(e.target.value) })
                }
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500"
              >
                {MONTH_NAMES.map((name, index) => (
                  <option key={index} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Year *
              </label>
              <input
                type="number"
                min="2020"
                max="2099"
                value={formData.year}
                onChange={(e) =>
                  setFormData({ ...formData, year: Number(e.target.value) })
                }
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-sm text-yellow-800">
              <strong>Note:</strong> Accruals are idempotent. If accrual has already been
              processed for this month/year, it will be skipped.
            </p>
          </div>
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setCalculateModalOpen(false)}
            disabled={calculating}
          >
            Cancel
          </Button>
          <Button onClick={handleCalculate} loading={calculating}>
            <Calculator className="w-4 h-4 mr-2" />
            Calculate Accrual
          </Button>
        </ModalFooter>
      </Modal>

      {/* Details Modal */}
      <Modal
        isOpen={detailsModalOpen}
        onClose={() => setDetailsModalOpen(false)}
        title={
          selectedRun
            ? `Accrual Details - ${MONTH_NAMES[selectedRun.month - 1]} ${selectedRun.year}`
            : 'Accrual Details'
        }
        size="xl"
      >
        {loadingEntries ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No accrual entries found for this run
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            {selectedRun && (
              <div className="bg-gray-50 rounded-lg p-4 grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-gray-500 uppercase">Total Employees</div>
                  <div className="text-xl font-bold text-gray-900">
                    {selectedRun.totalEmployeesProcessed}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase">Accruals Created</div>
                  <div className="text-xl font-bold text-primary-600">
                    {selectedRun.totalAccrualsCreated}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 uppercase">Errors</div>
                  <div className="text-xl font-bold text-red-600">
                    {selectedRun.totalErrors}
                  </div>
                </div>
              </div>
            )}

            {/* Entries Table */}
            <div className="overflow-x-auto max-h-96">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Employee
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Leave Type
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">
                      Before
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">
                      Accrued
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">
                      After
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-500">
                      Cap
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">
                          {entry.employee.firstName} {entry.employee.lastName}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-900">{entry.leaveType.name}</div>
                        <div className="text-xs text-gray-500">{entry.leaveType.code}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm text-gray-600">{entry.balanceBefore}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-semibold text-green-600">
                          +{entry.accrualDays}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-medium text-gray-900">
                          {entry.balanceAfter}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {entry.capApplied ? (
                          <span className="text-xs text-orange-600 font-medium">Applied</span>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <ModalFooter>
          <Button variant="secondary" onClick={() => setDetailsModalOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
