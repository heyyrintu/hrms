'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { accrualApi, leaveApi } from '@/lib/api';
import { RefreshCw, Plus, Edit2, Trash2, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';

interface AccrualRule {
  id: string;
  leaveTypeId: string;
  monthlyAccrualDays: number;
  maxBalanceCap: number | null;
  applyCapOnAccrual: boolean;
  leaveType: { id: string; name: string; code: string };
}

export default function AccrualRulesPage() {
  const [rules, setRules] = useState<AccrualRule[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AccrualRule | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState({
    leaveTypeId: '',
    monthlyAccrualDays: 0,
    maxBalanceCap: '',
    applyCapOnAccrual: true,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [rulesRes, typesRes] = await Promise.all([
        accrualApi.getRules(),
        leaveApi.getTypes(),
      ]);
      setRules(rulesRes.data);
      setLeaveTypes(typesRes.data);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingRule(null);
    setFormData({
      leaveTypeId: '',
      monthlyAccrualDays: 0,
      maxBalanceCap: '',
      applyCapOnAccrual: true,
    });
    setModalOpen(true);
  };

  const openEditModal = (rule: AccrualRule) => {
    setEditingRule(rule);
    setFormData({
      leaveTypeId: rule.leaveTypeId,
      monthlyAccrualDays: rule.monthlyAccrualDays,
      maxBalanceCap: rule.maxBalanceCap?.toString() || '',
      applyCapOnAccrual: rule.applyCapOnAccrual,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        leaveTypeId: formData.leaveTypeId,
        monthlyAccrualDays: Number(formData.monthlyAccrualDays),
        maxBalanceCap: formData.maxBalanceCap
          ? Number(formData.maxBalanceCap)
          : undefined,
        applyCapOnAccrual: formData.applyCapOnAccrual,
      };

      if (editingRule) {
        await accrualApi.updateRule(editingRule.id, payload);
        toast.success('Rule updated successfully');
      } else {
        await accrualApi.createRule(payload);
        toast.success('Rule created successfully');
      }

      setModalOpen(false);
      await loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this accrual rule?')) return;

    try {
      await accrualApi.deleteRule(id);
      toast.success('Rule deleted successfully');
      await loadData();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete rule');
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
            <Calendar className="w-7 h-7 text-primary-600" />
            Leave Accrual Rules
          </h1>
          <p className="text-gray-600 mt-1">
            Configure automatic leave accrual per leave type
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={loadData}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={openCreateModal}>
            <Plus className="w-4 h-4 mr-2" />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Rules Table */}
      <Card padding="none">
        {rules.length === 0 ? (
          <div className="p-12 text-center">
            <Calendar className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No Accrual Rules
            </h3>
            <p className="text-gray-500 mb-4">
              Create your first accrual rule to enable automatic leave accrual
            </p>
            <Button onClick={openCreateModal}>
              <Plus className="w-4 h-4 mr-2" />
              Add Rule
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">
                    Leave Type
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Monthly Accrual
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Max Cap
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase text-gray-500">
                    Apply Cap
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {rules.map((rule) => (
                  <tr key={rule.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {rule.leaveType.name}
                      </div>
                      <div className="text-sm text-gray-500">
                        {rule.leaveType.code}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className="font-semibold text-primary-600">
                        {rule.monthlyAccrualDays} days
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {rule.maxBalanceCap ? (
                        <span className="font-medium">
                          {rule.maxBalanceCap} days
                        </span>
                      ) : (
                        <span className="text-gray-400">No cap</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {rule.applyCapOnAccrual ? (
                        <span className="text-green-600">✓ On accrual</span>
                      ) : (
                        <span className="text-gray-500">Year-end</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => openEditModal(rule)}
                        className="text-primary-600 hover:text-primary-800 inline-flex items-center gap-1"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(rule.id)}
                        className="text-red-600 hover:text-red-800 inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingRule ? 'Edit Accrual Rule' : 'Create Accrual Rule'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Leave Type *
            </label>
            <select
              value={formData.leaveTypeId}
              onChange={(e) =>
                setFormData({ ...formData, leaveTypeId: e.target.value })
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500"
              required
            >
              <option value="">Select leave type</option>
              {leaveTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} ({type.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Monthly Accrual Days *
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={formData.monthlyAccrualDays}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  monthlyAccrualDays: Number(e.target.value),
                })
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., 2"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              Days to accrue per month (e.g., 2 for 2 sick leaves/month)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Maximum Balance Cap (Optional)
            </label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={formData.maxBalanceCap}
              onChange={(e) =>
                setFormData({ ...formData, maxBalanceCap: e.target.value })
              }
              className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-primary-500"
              placeholder="e.g., 30"
            />
            <p className="text-xs text-gray-500 mt-1">
              Maximum balance allowed (leave blank for no cap)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.applyCapOnAccrual}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  applyCapOnAccrual: e.target.checked,
                })
              }
              className="w-4 h-4 text-primary-600 rounded"
            />
            <label className="text-sm text-gray-700">
              Apply cap during accrual (vs. at year-end)
            </label>
          </div>
        </div>

        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setModalOpen(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {editingRule ? 'Update' : 'Create'} Rule
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
