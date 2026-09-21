'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { improvementPlansApi, employeesApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import toast from 'react-hot-toast';
import {
  ClipboardCheck,
  RefreshCw,
  Plus,
  Eye,
  Trash2,
  CheckCircle2,
  Circle,
} from 'lucide-react';

type PIPStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'EXTENDED' | 'TERMINATED';

interface ImprovementPlanGoal {
  id: string;
  planId: string;
  description: string;
  targetDate: string;
  isCompleted: boolean;
  completedAt?: string | null;
  notes?: string | null;
}

interface ImprovementPlanPerson {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string;
  department?: { name: string } | null;
}

interface ImprovementPlan {
  id: string;
  title: string;
  description: string;
  startDate: string;
  endDate: string;
  status: PIPStatus;
  employee?: ImprovementPlanPerson | null;
  manager?: ImprovementPlanPerson | null;
  goals?: ImprovementPlanGoal[];
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string;
}

type TabKey = 'mine' | 'team' | 'all';

const statusColors: Record<PIPStatus, 'gray' | 'warning' | 'success' | 'info' | 'danger'> = {
  DRAFT: 'gray',
  ACTIVE: 'warning',
  COMPLETED: 'success',
  EXTENDED: 'info',
  TERMINATED: 'danger',
};

const statusLabels: Record<PIPStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  EXTENDED: 'Extended',
  TERMINATED: 'Terminated',
};

const STATUS_OPTIONS: PIPStatus[] = [
  'DRAFT',
  'ACTIVE',
  'COMPLETED',
  'EXTENDED',
  'TERMINATED',
];

const emptyPlanForm = {
  employeeId: '',
  title: '',
  description: '',
  startDate: '',
  endDate: '',
  status: 'DRAFT' as PIPStatus,
};

export default function ImprovementPlansPage() {
  const { user, isManager, isAdmin } = useAuth();

  const defaultTab: TabKey = isAdmin ? 'all' : isManager ? 'team' : 'mine';
  const [activeTab, setActiveTab] = useState<TabKey>(defaultTab);

  const [plans, setPlans] = useState<ImprovementPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ total: 0, page: 1, limit: 20, totalPages: 0 });
  const [filterStatus, setFilterStatus] = useState('');

  // Detail modal
  const [detailModal, setDetailModal] = useState(false);
  const [detailPlan, setDetailPlan] = useState<ImprovementPlan | null>(null);
  const [savingGoalId, setSavingGoalId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  // Create modal
  const [createModal, setCreateModal] = useState(false);
  const [planForm, setPlanForm] = useState(emptyPlanForm);
  const [newGoals, setNewGoals] = useState<{ description: string; targetDate: string }[]>([]);
  const [goalDraft, setGoalDraft] = useState({ description: '', targetDate: '' });
  const [saving, setSaving] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  // Add-goal form inside the detail modal
  const [detailGoalDraft, setDetailGoalDraft] = useState({ description: '', targetDate: '' });

  const canRaise = isManager || isAdmin;
  // The manager who owns the plan, and HR, may reshape it.
  const canManageDetail =
    !!detailPlan && (isAdmin || detailPlan.manager?.id === user?.employeeId);
  const isMyPlan = !!detailPlan && detailPlan.employee?.id === user?.employeeId;

  const loadPlans = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params: Record<string, string> = {
          page: String(page),
          limit: String(meta.limit),
        };
        if (filterStatus) params.status = filterStatus;

        const res =
          activeTab === 'all'
            ? await improvementPlansApi.getAll(params)
            : activeTab === 'team'
              ? await improvementPlansApi.getTeam(params)
              : await improvementPlansApi.getMine(params);

        setPlans(res.data.data);
        setMeta(res.data.meta);
      } catch {
        toast.error('Failed to load improvement plans');
      } finally {
        setLoading(false);
      }
    },
    [activeTab, filterStatus, meta.limit],
  );

  useEffect(() => {
    loadPlans(1);
  }, [loadPlans]);

  const loadEmployees = useCallback(async () => {
    try {
      const res = await employeesApi.getAll({ limit: 200 });
      setEmployees(res.data.data ?? res.data ?? []);
    } catch {
      // The picker degrades to empty rather than blocking the whole page.
      setEmployees([]);
    }
  }, []);

  const openDetail = async (plan: ImprovementPlan) => {
    try {
      const res = await improvementPlansApi.getById(plan.id);
      setDetailPlan(res.data);
      setNoteDrafts(
        Object.fromEntries(
          (res.data.goals ?? []).map((g: ImprovementPlanGoal) => [g.id, g.notes ?? '']),
        ),
      );
      setDetailGoalDraft({ description: '', targetDate: '' });
      setDetailModal(true);
    } catch {
      toast.error('Failed to load plan details');
    }
  };

  const refreshDetail = async (planId: string) => {
    try {
      const res = await improvementPlansApi.getById(planId);
      setDetailPlan(res.data);
    } catch {
      toast.error('Failed to refresh plan');
    }
  };

  const openCreate = () => {
    setPlanForm(emptyPlanForm);
    setNewGoals([]);
    setGoalDraft({ description: '', targetDate: '' });
    setCreateModal(true);
    loadEmployees();
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      await improvementPlansApi.create({
        employeeId: planForm.employeeId,
        title: planForm.title,
        description: planForm.description,
        startDate: planForm.startDate,
        endDate: planForm.endDate,
        status: planForm.status,
        goals: newGoals.length > 0 ? newGoals : undefined,
      });
      toast.success('Improvement plan created');
      setCreateModal(false);
      loadPlans(1);
    } catch {
      toast.error('Failed to create improvement plan');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (status: PIPStatus) => {
    if (!detailPlan) return;
    setSaving(true);
    try {
      await improvementPlansApi.update(detailPlan.id, { status });
      toast.success('Plan status updated');
      await refreshDetail(detailPlan.id);
      loadPlans(meta.page);
    } catch {
      toast.error('Failed to update plan status');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleGoal = async (goal: ImprovementPlanGoal) => {
    if (!detailPlan) return;
    setSavingGoalId(goal.id);
    try {
      await improvementPlansApi.updateGoal(detailPlan.id, goal.id, {
        isCompleted: !goal.isCompleted,
      });
      toast.success(goal.isCompleted ? 'Goal reopened' : 'Goal completed');
      await refreshDetail(detailPlan.id);
    } catch {
      toast.error('Failed to update goal');
    } finally {
      setSavingGoalId(null);
    }
  };

  const handleSaveNote = async (goal: ImprovementPlanGoal) => {
    if (!detailPlan) return;
    setSavingGoalId(goal.id);
    try {
      await improvementPlansApi.updateGoal(detailPlan.id, goal.id, {
        notes: noteDrafts[goal.id] ?? '',
      });
      toast.success('Note saved');
      await refreshDetail(detailPlan.id);
    } catch {
      toast.error('Failed to save note');
    } finally {
      setSavingGoalId(null);
    }
  };

  const handleAddDetailGoal = async () => {
    if (!detailPlan) return;
    setSaving(true);
    try {
      await improvementPlansApi.addGoal(detailPlan.id, detailGoalDraft);
      toast.success('Goal added');
      setDetailGoalDraft({ description: '', targetDate: '' });
      await refreshDetail(detailPlan.id);
    } catch {
      toast.error('Failed to add goal');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteGoal = async (goal: ImprovementPlanGoal) => {
    if (!detailPlan) return;
    setSavingGoalId(goal.id);
    try {
      await improvementPlansApi.deleteGoal(detailPlan.id, goal.id);
      toast.success('Goal deleted');
      await refreshDetail(detailPlan.id);
    } catch {
      toast.error('Failed to delete goal');
    } finally {
      setSavingGoalId(null);
    }
  };

  const goalProgress = (plan: ImprovementPlan) => {
    const goals = plan.goals ?? [];
    if (goals.length === 0) return '-';
    const done = goals.filter((g) => g.isCompleted).length;
    return `${done}/${goals.length}`;
  };

  const personName = (person?: ImprovementPlanPerson | null) =>
    person ? `${person.firstName} ${person.lastName}` : '-';

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'mine', label: 'My Plans' },
    ...(isManager || isAdmin ? [{ key: 'team' as TabKey, label: 'My Team' }] : []),
    ...(isAdmin ? [{ key: 'all' as TabKey, label: 'All Plans' }] : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900">
              Improvement Plans
            </h1>
            <p className="text-sm text-warm-500">
              Track performance improvement plans and their goals
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => loadPlans(meta.page)}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {canRaise && (
            <Button variant="primary" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              New Plan
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-warm-200">
        <nav className="flex gap-4">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-warm-500 hover:text-warm-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          aria-label="Filter by status"
          className="rounded-md border border-warm-300 px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {statusLabels[s]}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
            </div>
          ) : plans.length === 0 ? (
            <div className="text-center py-12 text-warm-500">
              <ClipboardCheck className="h-12 w-12 mx-auto mb-3 text-warm-300" />
              <p className="text-lg font-medium">No improvement plans</p>
              <p className="text-sm">
                Plans will appear here once one is raised
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-warm-50">
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Employee</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Manager</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Period</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Goals</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id} className="border-b hover:bg-warm-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-warm-900">
                          {personName(plan.employee)}
                        </p>
                        {plan.employee?.department && (
                          <p className="text-xs text-warm-500">
                            {plan.employee.department.name}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-warm-900">{plan.title}</td>
                      <td className="px-4 py-3 text-warm-600">
                        {personName(plan.manager)}
                      </td>
                      <td className="px-4 py-3 text-warm-600">
                        {new Date(plan.startDate).toLocaleDateString()} -{' '}
                        {new Date(plan.endDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-warm-600">{goalProgress(plan)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={statusColors[plan.status]}>
                          {statusLabels[plan.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => openDetail(plan)}
                          className="text-warm-500 hover:text-warm-700"
                          title="View Details"
                          aria-label={`View ${plan.title}`}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Modal
        isOpen={detailModal}
        onClose={() => setDetailModal(false)}
        title={detailPlan ? detailPlan.title : 'Improvement Plan'}
        size="lg"
      >
        {detailPlan && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-warm-500">Employee</p>
                <p className="text-sm font-medium">{personName(detailPlan.employee)}</p>
              </div>
              <div>
                <p className="text-xs text-warm-500">Manager</p>
                <p className="text-sm font-medium">{personName(detailPlan.manager)}</p>
              </div>
              <div>
                <p className="text-xs text-warm-500">Period</p>
                <p className="text-sm font-medium">
                  {new Date(detailPlan.startDate).toLocaleDateString()} -{' '}
                  {new Date(detailPlan.endDate).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-warm-500">Status</p>
                <Badge variant={statusColors[detailPlan.status]}>
                  {statusLabels[detailPlan.status]}
                </Badge>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-xs text-warm-500 mb-1">Description</p>
              <p className="text-sm text-warm-600 bg-warm-50 p-3 rounded">
                {detailPlan.description}
              </p>
            </div>

            {canManageDetail && (
              <div className="border-t pt-4">
                <label className="block text-sm font-medium text-warm-700 mb-1">
                  Move status to
                </label>
                <select
                  value={detailPlan.status}
                  onChange={(e) => handleStatusChange(e.target.value as PIPStatus)}
                  disabled={saving}
                  aria-label="Plan status"
                  className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-warm-900 mb-2">
                Goals ({detailPlan.goals?.length ?? 0})
              </h4>
              {(detailPlan.goals ?? []).length === 0 ? (
                <p className="text-sm text-warm-500">No goals on this plan yet</p>
              ) : (
                <div className="space-y-3">
                  {(detailPlan.goals ?? []).map((goal) => (
                    <div key={goal.id} className="bg-warm-50 p-3 rounded space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <button
                            onClick={() => handleToggleGoal(goal)}
                            disabled={savingGoalId === goal.id}
                            title={goal.isCompleted ? 'Reopen goal' : 'Mark complete'}
                            aria-label={
                              goal.isCompleted
                                ? `Reopen ${goal.description}`
                                : `Complete ${goal.description}`
                            }
                            className="mt-0.5"
                          >
                            {goal.isCompleted ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <Circle className="h-4 w-4 text-warm-400" />
                            )}
                          </button>
                          <div>
                            <p
                              className={`text-sm ${
                                goal.isCompleted
                                  ? 'line-through text-warm-400'
                                  : 'text-warm-900'
                              }`}
                            >
                              {goal.description}
                            </p>
                            <p className="text-xs text-warm-500">
                              Due {new Date(goal.targetDate).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        {canManageDetail && (
                          <button
                            onClick={() => handleDeleteGoal(goal)}
                            disabled={savingGoalId === goal.id}
                            className="text-red-500 hover:text-red-700"
                            title="Delete goal"
                            aria-label={`Delete ${goal.description}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {(isMyPlan || canManageDetail) && (
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <label className="block text-xs text-warm-500 mb-1">
                              Notes
                            </label>
                            <textarea
                              value={noteDrafts[goal.id] ?? ''}
                              onChange={(e) =>
                                setNoteDrafts({
                                  ...noteDrafts,
                                  [goal.id]: e.target.value,
                                })
                              }
                              rows={2}
                              aria-label={`Notes for ${goal.description}`}
                              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                          </div>
                          <Button
                            variant="secondary"
                            onClick={() => handleSaveNote(goal)}
                            disabled={savingGoalId === goal.id}
                          >
                            Save Note
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {canManageDetail && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-warm-900 mb-2">Add Goal</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={detailGoalDraft.description}
                      onChange={(e) =>
                        setDetailGoalDraft({
                          ...detailGoalDraft,
                          description: e.target.value,
                        })
                      }
                      placeholder="What has to improve"
                      aria-label="New goal description"
                      className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <input
                      type="date"
                      value={detailGoalDraft.targetDate}
                      onChange={(e) =>
                        setDetailGoalDraft({
                          ...detailGoalDraft,
                          targetDate: e.target.value,
                        })
                      }
                      aria-label="New goal target date"
                      className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <Button
                    variant="secondary"
                    onClick={handleAddDetailGoal}
                    disabled={
                      saving ||
                      !detailGoalDraft.description ||
                      !detailGoalDraft.targetDate
                    }
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Goal
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDetailModal(false)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* Create Modal */}
      <Modal
        isOpen={createModal}
        onClose={() => setCreateModal(false)}
        title="New Improvement Plan"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Employee *
            </label>
            <select
              value={planForm.employeeId}
              onChange={(e) => setPlanForm({ ...planForm, employeeId: e.target.value })}
              aria-label="Employee"
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select employee...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName}
                  {emp.employeeCode ? ` (${emp.employeeCode})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">Title *</label>
            <input
              type="text"
              value={planForm.title}
              onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })}
              placeholder="e.g. Improve delivery consistency"
              aria-label="Title"
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Description *
            </label>
            <textarea
              value={planForm.description}
              onChange={(e) =>
                setPlanForm({ ...planForm, description: e.target.value })
              }
              rows={3}
              aria-label="Description"
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Start Date *
              </label>
              <input
                type="date"
                value={planForm.startDate}
                onChange={(e) =>
                  setPlanForm({ ...planForm, startDate: e.target.value })
                }
                aria-label="Start date"
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                End Date *
              </label>
              <input
                type="date"
                value={planForm.endDate}
                onChange={(e) => setPlanForm({ ...planForm, endDate: e.target.value })}
                aria-label="End date"
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Status
              </label>
              <select
                value={planForm.status}
                onChange={(e) =>
                  setPlanForm({ ...planForm, status: e.target.value as PIPStatus })
                }
                aria-label="Initial status"
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
              </select>
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="text-sm font-medium text-warm-900 mb-2">
              Goals ({newGoals.length})
            </h4>
            {newGoals.length > 0 && (
              <div className="space-y-2 mb-3">
                {newGoals.map((goal, i) => (
                  <div
                    key={`${goal.description}-${i}`}
                    className="flex items-center justify-between bg-warm-50 p-2 rounded"
                  >
                    <div>
                      <p className="text-sm text-warm-900">{goal.description}</p>
                      <p className="text-xs text-warm-500">
                        Due {new Date(goal.targetDate).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        setNewGoals(newGoals.filter((_, idx) => idx !== i))
                      }
                      className="text-red-500 hover:text-red-700"
                      title="Remove goal"
                      aria-label={`Remove ${goal.description}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <input
                  type="text"
                  value={goalDraft.description}
                  onChange={(e) =>
                    setGoalDraft({ ...goalDraft, description: e.target.value })
                  }
                  placeholder="What has to improve"
                  aria-label="Goal description"
                  className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
              <div>
                <input
                  type="date"
                  value={goalDraft.targetDate}
                  onChange={(e) =>
                    setGoalDraft({ ...goalDraft, targetDate: e.target.value })
                  }
                  aria-label="Goal target date"
                  className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="mt-2 flex justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setNewGoals([...newGoals, goalDraft]);
                  setGoalDraft({ description: '', targetDate: '' });
                }}
                disabled={!goalDraft.description || !goalDraft.targetDate}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Goal
              </Button>
            </div>
          </div>
        </div>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setCreateModal(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={
              saving ||
              !planForm.employeeId ||
              !planForm.title ||
              !planForm.description ||
              !planForm.startDate ||
              !planForm.endDate
            }
          >
            {saving ? 'Saving...' : 'Create Plan'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
