'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { exitApi, employeesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Plus,
  RefreshCw,
  LogOut,
  Search,
  ArrowRight,
  CheckCircle,
  XCircle,
  Eye,
} from 'lucide-react';
import { SeparationType, SeparationStatus } from '@/types';
import type { Separation, Employee } from '@/types';
import toast from 'react-hot-toast';

const separationTypeOptions = Object.values(SeparationType).map((t) => ({
  value: t,
  label: t.replace(/_/g, ' '),
}));

const statusColors: Record<SeparationStatus, string> = {
  [SeparationStatus.INITIATED]: 'info',
  [SeparationStatus.NOTICE_PERIOD]: 'warning',
  [SeparationStatus.CLEARANCE_PENDING]: 'warning',
  [SeparationStatus.COMPLETED]: 'success',
  [SeparationStatus.CANCELLED]: 'gray',
};

const typeColors: Record<SeparationType, string> = {
  [SeparationType.RESIGNATION]: 'info',
  [SeparationType.TERMINATION]: 'danger',
  [SeparationType.RETIREMENT]: 'gray',
  [SeparationType.END_OF_CONTRACT]: 'gray',
  [SeparationType.MUTUAL_SEPARATION]: 'warning',
  [SeparationType.ABSCONDING]: 'danger',
};

export default function ExitManagementPage() {
  const [separations, setSeparations] = useState<Separation[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Initiate modal
  const [initiateModalOpen, setInitiateModalOpen] = useState(false);
  const [initiateForm, setInitiateForm] = useState({
    employeeId: '',
    type: SeparationType.RESIGNATION as SeparationType,
    reason: '',
    lastWorkingDate: '',
    noticePeriodDays: 30,
    isNoticePeriodWaived: false,
  });
  const [saving, setSaving] = useState(false);

  // Detail modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedSeparation, setSelectedSeparation] = useState<Separation | null>(null);

  useEffect(() => {
    loadData();
  }, [filterStatus]);

  const loadData = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (filterStatus) params.status = filterStatus;
      const [sRes, eRes] = await Promise.all([
        exitApi.getAll(params),
        employeesApi.getAll({ limit: 500, status: 'ACTIVE' }),
      ]);
      setSeparations(sRes.data);
      setEmployees(eRes.data.data || eRes.data || []);
    } catch (error) {
      console.error('Failed to load exit data:', error);
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleInitiate = async () => {
    if (!initiateForm.employeeId) {
      toast.error('Select an employee');
      return;
    }
    setSaving(true);
    try {
      await exitApi.initiate({
        ...initiateForm,
        lastWorkingDate: initiateForm.lastWorkingDate || undefined,
      });
      toast.success('Separation initiated');
      setInitiateModalOpen(false);
      await loadData();
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to initiate separation';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id: string, action: 'notice-period' | 'clearance' | 'complete' | 'cancel') => {
    setSaving(true);
    try {
      const actions = {
        'notice-period': exitApi.moveToNoticePeriod,
        clearance: exitApi.moveToClearance,
        complete: exitApi.complete,
        cancel: exitApi.cancel,
      };
      await actions[action](id);
      toast.success(`Separation ${action === 'cancel' ? 'cancelled' : 'updated'}`);
      setDetailModalOpen(false);
      await loadData();
    } catch (error: unknown) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Action failed';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const openDetail = async (sep: Separation) => {
    try {
      const res = await exitApi.getById(sep.id);
      setSelectedSeparation(res.data);
      setDetailModalOpen(true);
    } catch {
      toast.error('Failed to load details');
    }
  };

  const filteredSeparations = separations.filter((s) => {
    const empName = s.employee
      ? `${s.employee.firstName} ${s.employee.lastName} ${s.employee.employeeCode}`
      : '';
    return empName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const statusCounts = {
    all: separations.length,
    active: separations.filter((s) => !['COMPLETED', 'CANCELLED'].includes(s.status)).length,
    completed: separations.filter((s) => s.status === 'COMPLETED').length,
    cancelled: separations.filter((s) => s.status === 'CANCELLED').length,
  };

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
              <LogOut className="w-7 h-7 text-primary-600" />
              Exit Management
            </h1>
            <p className="text-warm-600 mt-1">
              Manage employee separations, notice periods, and clearance
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={loadData} disabled={loading}>
              <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={() => {
              setInitiateForm({
                employeeId: '',
                type: SeparationType.RESIGNATION,
                reason: '',
                lastWorkingDate: '',
                noticePeriodDays: 30,
                isNoticePeriodWaived: false,
              });
              setInitiateModalOpen(true);
            }}>
              <Plus className="w-4 h-4 mr-2" />
              Initiate Separation
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-warm-900">{statusCounts.all}</p>
              <p className="text-sm text-warm-500">Total</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{statusCounts.active}</p>
              <p className="text-sm text-warm-500">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{statusCounts.completed}</p>
              <p className="text-sm text-warm-500">Completed</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4 text-center">
              <p className="text-2xl font-bold text-warm-400">{statusCounts.cancelled}</p>
              <p className="text-sm text-warm-500">Cancelled</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
            <input
              type="text"
              placeholder="Search by employee..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Statuses</option>
            {Object.values(SeparationStatus).map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : filteredSeparations.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <LogOut className="w-16 h-16 text-warm-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-warm-900 mb-2">No Separations Found</h3>
              <p className="text-warm-600">No exit processes match your filters.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredSeparations.map((sep) => (
              <Card key={sep.id}>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-warm-900">
                          {sep.employee ? `${sep.employee.firstName} ${sep.employee.lastName}` : 'Unknown'}
                        </h3>
                        {sep.employee?.employeeCode && (
                          <span className="text-xs text-warm-400">{sep.employee.employeeCode}</span>
                        )}
                        <Badge variant={typeColors[sep.type] as 'info' | 'danger' | 'gray' | 'warning'}>
                          {sep.type.replace(/_/g, ' ')}
                        </Badge>
                        <Badge variant={statusColors[sep.status] as 'info' | 'warning' | 'success' | 'gray'}>
                          {sep.status.replace(/_/g, ' ')}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 mt-2 text-xs text-warm-400">
                        <span>Initiated {formatDate(sep.initiatedDate)}</span>
                        {sep.lastWorkingDate && (
                          <span>LWD: {formatDate(sep.lastWorkingDate)}</span>
                        )}
                        <span>{sep.noticePeriodDays}d notice{sep.isNoticePeriodWaived ? ' (waived)' : ''}</span>
                        {sep.employee?.department && <span>{sep.employee.department.name}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => openDetail(sep)}
                      className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                      title="View Details"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Initiate Separation Modal */}
      <Modal
        isOpen={initiateModalOpen}
        onClose={() => setInitiateModalOpen(false)}
        title="Initiate Separation"
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Employee *</label>
            <select
              value={initiateForm.employeeId}
              onChange={(e) => setInitiateForm({ ...initiateForm, employeeId: e.target.value })}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select employee...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName} ({emp.employeeCode})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Type *</label>
              <select
                value={initiateForm.type}
                onChange={(e) => setInitiateForm({ ...initiateForm, type: e.target.value as SeparationType })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                {separationTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Notice Period (days)</label>
              <input
                type="number"
                value={initiateForm.noticePeriodDays}
                onChange={(e) => setInitiateForm({ ...initiateForm, noticePeriodDays: parseInt(e.target.value) || 0 })}
                min={0}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Last Working Date</label>
            <input
              type="date"
              value={initiateForm.lastWorkingDate}
              onChange={(e) => setInitiateForm({ ...initiateForm, lastWorkingDate: e.target.value })}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Reason</label>
            <textarea
              value={initiateForm.reason}
              onChange={(e) => setInitiateForm({ ...initiateForm, reason: e.target.value })}
              placeholder="Reason for separation..."
              rows={3}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={initiateForm.isNoticePeriodWaived}
              onChange={(e) => setInitiateForm({ ...initiateForm, isNoticePeriodWaived: e.target.checked })}
              className="w-4 h-4 text-primary-600 border-warm-300 rounded focus:ring-primary-500"
            />
            <span className="text-sm text-warm-700">Waive notice period</span>
          </label>
        </div>

        <ModalFooter>
          <Button variant="secondary" onClick={() => setInitiateModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleInitiate} loading={saving} disabled={!initiateForm.employeeId}>
            Initiate
          </Button>
        </ModalFooter>
      </Modal>

      {/* Detail / Actions Modal */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title="Separation Details"
        size="lg"
      >
        {selectedSeparation && (
          <div className="space-y-4">
            {/* Employee info */}
            <div className="flex items-center gap-3 p-3 bg-warm-50 rounded-lg">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100">
                <span className="text-primary-700 font-semibold">
                  {selectedSeparation.employee?.firstName?.charAt(0)}
                </span>
              </div>
              <div>
                <p className="font-medium text-warm-900">
                  {selectedSeparation.employee?.firstName} {selectedSeparation.employee?.lastName}
                </p>
                <p className="text-xs text-warm-500">
                  {selectedSeparation.employee?.employeeCode} · {selectedSeparation.employee?.email}
                </p>
              </div>
            </div>

            {/* Status and Type */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-warm-500 mb-1">Type</p>
                <Badge variant={typeColors[selectedSeparation.type] as 'info' | 'danger' | 'gray' | 'warning'}>
                  {selectedSeparation.type.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div>
                <p className="text-xs font-medium text-warm-500 mb-1">Status</p>
                <Badge variant={statusColors[selectedSeparation.status] as 'info' | 'warning' | 'success' | 'gray'}>
                  {selectedSeparation.status.replace(/_/g, ' ')}
                </Badge>
              </div>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-warm-500">Initiated</p>
                <p className="font-medium">{formatDate(selectedSeparation.initiatedDate)}</p>
              </div>
              <div>
                <p className="text-warm-500">Last Working Date</p>
                <p className="font-medium">{selectedSeparation.lastWorkingDate ? formatDate(selectedSeparation.lastWorkingDate) : 'Not set'}</p>
              </div>
              <div>
                <p className="text-warm-500">Notice Period</p>
                <p className="font-medium">{selectedSeparation.noticePeriodDays} days{selectedSeparation.isNoticePeriodWaived ? ' (waived)' : ''}</p>
              </div>
              <div>
                <p className="text-warm-500">Exit Interview</p>
                <p className="font-medium">{selectedSeparation.exitInterviewDone ? 'Done' : 'Pending'}</p>
              </div>
            </div>

            {selectedSeparation.reason && (
              <div>
                <p className="text-xs font-medium text-warm-500 mb-1">Reason</p>
                <p className="text-sm text-warm-700 bg-warm-50 p-2 rounded">{selectedSeparation.reason}</p>
              </div>
            )}

            {selectedSeparation.completedAt && (
              <div>
                <p className="text-xs font-medium text-warm-500 mb-1">Completed</p>
                <p className="text-sm font-medium text-emerald-600">{formatDate(selectedSeparation.completedAt)}</p>
              </div>
            )}

            {/* Workflow Actions */}
            {!['COMPLETED', 'CANCELLED'].includes(selectedSeparation.status) && (
              <div className="border-t border-warm-200 pt-4">
                <p className="text-xs font-medium text-warm-500 mb-2">Actions</p>
                <div className="flex flex-wrap gap-2">
                  {selectedSeparation.status === SeparationStatus.INITIATED && (
                    <Button size="sm" variant="secondary" onClick={() => handleAction(selectedSeparation.id, 'notice-period')} loading={saving}>
                      <ArrowRight className="w-3 h-3 mr-1" />
                      Start Notice Period
                    </Button>
                  )}
                  {(selectedSeparation.status === SeparationStatus.INITIATED || selectedSeparation.status === SeparationStatus.NOTICE_PERIOD) && (
                    <Button size="sm" variant="secondary" onClick={() => handleAction(selectedSeparation.id, 'clearance')} loading={saving}>
                      <ArrowRight className="w-3 h-3 mr-1" />
                      Move to Clearance
                    </Button>
                  )}
                  <Button size="sm" onClick={() => handleAction(selectedSeparation.id, 'complete')} loading={saving}>
                    <CheckCircle className="w-3 h-3 mr-1" />
                    Complete
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleAction(selectedSeparation.id, 'cancel')} loading={saving}>
                    <XCircle className="w-3 h-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDetailModalOpen(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
