'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { performanceApi } from '@/lib/api';
import { ReviewCycle, ReviewCycleStatus } from '@/types';
import toast from 'react-hot-toast';
import {
  Target,
  RefreshCw,
  Plus,
  Edit2,
  Trash2,
  Rocket,
  CheckCircle,
} from 'lucide-react';

const statusColors: Record<ReviewCycleStatus, string> = {
  DRAFT: 'gray',
  ACTIVE: 'info',
  COMPLETED: 'success',
};

const statusLabels: Record<ReviewCycleStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
};

const emptyForm = {
  name: '',
  description: '',
  startDate: '',
  endDate: '',
};

export default function ReviewCyclesPage() {
  const [cycles, setCycles] = useState<ReviewCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [filterStatus, setFilterStatus] = useState('');

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCycle, setEditingCycle] = useState<ReviewCycle | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Delete / Launch / Complete modals
  const [deleteModal, setDeleteModal] = useState(false);
  const [deletingCycle, setDeletingCycle] = useState<ReviewCycle | null>(null);
  const [launchModal, setLaunchModal] = useState(false);
  const [launchingCycle, setLaunchingCycle] = useState<ReviewCycle | null>(null);
  const [completeModal, setCompleteModal] = useState(false);
  const [completingCycle, setCompletingCycle] = useState<ReviewCycle | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadCycles = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page),
        limit: String(meta.limit),
      };
      if (filterStatus) params.status = filterStatus;
      const res = await performanceApi.getCycles(params);
      setCycles(res.data.data);
      setMeta(res.data.meta);
    } catch {
      toast.error('Failed to load review cycles');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, meta.limit]);

  useEffect(() => {
    loadCycles(1);
  }, [loadCycles]);

  const openModal = (cycle?: ReviewCycle) => {
    if (cycle) {
      setEditingCycle(cycle);
      setFormData({
        name: cycle.name,
        description: cycle.description || '',
        startDate: cycle.startDate.split('T')[0],
        endDate: cycle.endDate.split('T')[0],
      });
    } else {
      setEditingCycle(null);
      setFormData(emptyForm);
    }
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingCycle) {
        await performanceApi.updateCycle(editingCycle.id, formData);
        toast.success('Cycle updated');
      } else {
        await performanceApi.createCycle(formData);
        toast.success('Cycle created');
      }
      setModalOpen(false);
      loadCycles(meta.page);
    } catch {
      toast.error('Failed to save cycle');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingCycle) return;
    setActionLoading(true);
    try {
      await performanceApi.deleteCycle(deletingCycle.id);
      toast.success('Cycle deleted');
      setDeleteModal(false);
      setDeletingCycle(null);
      loadCycles(meta.page);
    } catch {
      toast.error('Failed to delete cycle');
    } finally {
      setActionLoading(false);
    }
  };

  const handleLaunch = async () => {
    if (!launchingCycle) return;
    setActionLoading(true);
    try {
      const res = await performanceApi.launchCycle(launchingCycle.id);
      const count = res.data.reviewsCreated || 0;
      toast.success(`Cycle launched! ${count} reviews created.`);
      setLaunchModal(false);
      setLaunchingCycle(null);
      loadCycles(meta.page);
    } catch {
      toast.error('Failed to launch cycle');
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = async () => {
    if (!completingCycle) return;
    setActionLoading(true);
    try {
      await performanceApi.completeCycle(completingCycle.id);
      toast.success('Cycle marked as completed');
      setCompleteModal(false);
      setCompletingCycle(null);
      loadCycles(meta.page);
    } catch {
      toast.error('Failed to complete cycle');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <Target className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Review Cycles</h1>
            <p className="text-sm text-warm-500">
              Manage performance review cycles
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => loadCycles(meta.page)}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="primary" onClick={() => openModal()}>
            <Plus className="h-4 w-4 mr-2" />
            Create Cycle
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border border-warm-300 px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
            </div>
          ) : cycles.length === 0 ? (
            <div className="text-center py-12 text-warm-500">
              <Target className="h-12 w-12 mx-auto mb-3 text-warm-300" />
              <p className="text-lg font-medium">No review cycles</p>
              <p className="text-sm">Create your first review cycle to get started</p>
              <Button variant="primary" onClick={() => openModal()} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Create Cycle
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-warm-50">
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Start Date</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">End Date</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Reviews</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {cycles.map((cycle) => (
                    <tr key={cycle.id} className="border-b hover:bg-warm-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-warm-900">{cycle.name}</p>
                        {cycle.description && (
                          <p className="text-xs text-warm-500 mt-0.5">{cycle.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-warm-600">
                        {new Date(cycle.startDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-warm-600">
                        {new Date(cycle.endDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusColors[cycle.status] as 'gray' | 'info' | 'success'}>
                          {statusLabels[cycle.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-warm-600">
                        {cycle._count?.reviews ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {cycle.status === 'DRAFT' && (
                            <>
                              <button
                                onClick={() => openModal(cycle)}
                                className="text-warm-500 hover:text-warm-700"
                                title="Edit"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => { setLaunchingCycle(cycle); setLaunchModal(true); }}
                                className="text-blue-500 hover:text-blue-700"
                                title="Launch"
                              >
                                <Rocket className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => { setDeletingCycle(cycle); setDeleteModal(true); }}
                                className="text-red-500 hover:text-red-700"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          {cycle.status === 'ACTIVE' && (
                            <button
                              onClick={() => { setCompletingCycle(cycle); setCompleteModal(true); }}
                              className="text-emerald-600 hover:text-emerald-800"
                              title="Complete"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCycle ? 'Edit Review Cycle' : 'Create Review Cycle'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Q1 2026 Review"
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">Start Date *</label>
              <input
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">End Date *</label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={saving || !formData.name || !formData.startDate || !formData.endDate}
          >
            {saving ? 'Saving...' : editingCycle ? 'Update' : 'Create'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Launch Confirmation */}
      <Modal
        isOpen={launchModal}
        onClose={() => setLaunchModal(false)}
        title="Launch Review Cycle"
      >
        <p className="text-sm text-warm-600">
          This will create performance reviews for all active employees with managers.
          Employees will be notified to complete their self-reviews.
        </p>
        <p className="text-sm font-medium text-warm-900 mt-2">
          Launch &quot;{launchingCycle?.name}&quot;?
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setLaunchModal(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleLaunch} disabled={actionLoading}>
            {actionLoading ? 'Launching...' : 'Launch Cycle'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Complete Confirmation */}
      <Modal
        isOpen={completeModal}
        onClose={() => setCompleteModal(false)}
        title="Complete Review Cycle"
      >
        <p className="text-sm text-warm-600">
          Mark &quot;{completingCycle?.name}&quot; as completed? This will close the cycle.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setCompleteModal(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleComplete} disabled={actionLoading}>
            {actionLoading ? 'Completing...' : 'Complete Cycle'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        isOpen={deleteModal}
        onClose={() => setDeleteModal(false)}
        title="Delete Review Cycle"
      >
        <p className="text-sm text-warm-600">
          Are you sure you want to delete &quot;{deletingCycle?.name}&quot;? This action cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteModal(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={actionLoading}>
            {actionLoading ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
