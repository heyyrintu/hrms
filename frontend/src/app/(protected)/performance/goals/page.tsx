'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, Trash2, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { goalsApi } from '@/lib/api-performance-goals';
import type { Goal, GoalDetail, GoalInput, GoalOwnerType, GoalScope, GoalTreeNode } from '@/lib/api-performance-goals';
import { GoalTree } from '@/components/performance/goals/GoalTree';
import { GoalFormModal } from '@/components/performance/goals/GoalFormModal';
import { KeyResultEditor } from '@/components/performance/goals/KeyResultEditor';
import { STATUS_LABEL, STATUS_VARIANT, ownerLabel } from '@/components/performance/goals/goal-utils';

type TabKey = 'tree' | GoalScope;

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

export default function GoalsPage() {
  const { isAdmin, isManager } = useAuth();

  const tabs = useMemo(() => {
    const t: Array<{ key: TabKey; label: string }> = [
      { key: 'tree', label: 'Alignment tree' },
      { key: 'mine', label: 'My goals' },
    ];
    if (isManager || isAdmin) t.push({ key: 'team', label: 'Team goals' });
    t.push({ key: 'company', label: 'Company' }, { key: 'department', label: 'Department' });
    return t;
  }, [isManager, isAdmin]);

  const [tab, setTab] = useState<TabKey>('tree');
  const [tree, setTree] = useState<GoalTreeNode[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);
  const [newOwnerType, setNewOwnerType] = useState<GoalOwnerType>('EMPLOYEE');

  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Only the most recent request may write state: a slow earlier tab must not overwrite a later one.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      if (tab === 'tree') {
        const res = await goalsApi.tree();
        if (id !== requestId.current) return;
        setTree(res.data);
      } else {
        const res = await goalsApi.list({ scope: tab });
        if (id !== requestId.current) return;
        setGoals(res.data);
      }
    } catch {
      if (id !== requestId.current) return;
      setError(true);
      toast.error('Failed to load goals');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await goalsApi.get(id);
      setDetail(res.data);
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to load goal'));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await load();
    if (detail) {
      try {
        const res = await goalsApi.get(detail.id);
        setDetail(res.data);
      } catch {
        setDetail(null);
      }
    }
  }, [load, detail]);

  const openNew = (ownerType: GoalOwnerType) => {
    setEditing(null);
    setNewOwnerType(ownerType);
    setFormOpen(true);
  };

  const handleSave = async (data: GoalInput, goalId?: string) => {
    try {
      if (goalId) {
        await goalsApi.update(goalId, data);
        toast.success('Goal updated');
      } else {
        await goalsApi.create(data);
        toast.success('Goal created');
      }
      setFormOpen(false);
      setEditing(null);
      await refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save goal'));
    }
  };

  const handleDelete = async (goal: Goal) => {
    if (!window.confirm(`Delete goal "${goal.title}"?`)) return;
    try {
      await goalsApi.remove(goal.id);
      toast.success('Goal deleted');
      setDetail(null);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to delete goal'));
    }
  };

  const empty = tab === 'tree' ? tree.length === 0 : goals.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-warm-900">Goals</h1>
          <p className="text-sm text-warm-500">Align company, department and personal goals with measurable key results.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button onClick={() => openNew('EMPLOYEE')}>
            <Plus className="h-4 w-4 mr-1" /> New goal
          </Button>
          {isAdmin && (
            <>
              <Button variant="secondary" onClick={() => openNew('COMPANY')}>New company goal</Button>
              <Button variant="secondary" onClick={() => openNew('DEPARTMENT')}>New department goal</Button>
            </>
          )}
        </div>
      </div>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-warm-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-warm-500 hover:text-warm-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-warm-500">Loading goals...</p>
      ) : error ? (
        <Card><CardContent className="p-6 text-center text-sm text-red-600">Could not load goals. Try refreshing.</CardContent></Card>
      ) : empty ? (
        <Card><CardContent className="p-8 text-center text-warm-500">No goals to show here yet.</CardContent></Card>
      ) : tab === 'tree' ? (
        <GoalTree nodes={tree} onSelect={openDetail} />
      ) : (
        <div className="space-y-2">
          {goals.map((g) => (
            <Card key={g.id}>
              <CardContent className="p-3 flex flex-wrap items-center gap-3">
                <Badge variant="default">{ownerLabel(g)}</Badge>
                <button type="button" onClick={() => openDetail(g.id)} className="font-medium text-warm-900 hover:text-primary-600 text-left">
                  {g.title}
                </button>
                <Badge variant={STATUS_VARIANT[g.status]}>{STATUS_LABEL[g.status]}</Badge>
                {g.keyResults.length > 0 && <span className="text-xs text-warm-500">{g.keyResults.length} KRs</span>}
                <span className="ml-auto text-sm text-warm-600">{Math.round(g.progress)}%</span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <GoalFormModal
        isOpen={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSave={handleSave}
        goal={editing}
        isAdmin={isAdmin}
        initialOwnerType={newOwnerType}
      />

      <Modal isOpen={detailLoading || detail !== null} onClose={() => setDetail(null)} title={detail?.title ?? 'Goal'} size="2xl">
        {detail ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">{ownerLabel(detail)}</Badge>
              <Badge variant={STATUS_VARIANT[detail.status]}>{STATUS_LABEL[detail.status]}</Badge>
              <span className="text-sm text-warm-600">{Math.round(detail.progress)}% complete</span>
              {detail.isDerived && <span className="text-xs text-warm-400">(calculated)</span>}
              {detail.canEdit && (
                <div className="ml-auto flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => { setEditing(detail); setFormOpen(true); }}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(detail)}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                  </Button>
                </div>
              )}
            </div>
            {detail.description && <p className="text-sm text-warm-700">{detail.description}</p>}
            <p className="text-xs text-warm-500">Target date: {detail.targetDate.split('T')[0]}</p>

            {detail.parent && (
              <div>
                <h4 className="text-sm font-semibold text-warm-800 mb-1">Aligned to</h4>
                <button type="button" className="text-sm text-primary-600 hover:underline" onClick={() => openDetail(detail.parent!.id)}>
                  {ownerLabel(detail.parent)}: {detail.parent.title}
                </button>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold text-warm-800 mb-2">Key results</h4>
              <KeyResultEditor goalId={detail.id} keyResults={detail.keyResults} canEdit={detail.canEdit} onChanged={refreshAll} />
            </div>

            <div>
              <h4 className="text-sm font-semibold text-warm-800 mb-2">Child goals</h4>
              {detail.children.length === 0 ? (
                <p className="text-sm text-warm-500">No goals are aligned to this one.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.children.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="gray">{ownerLabel(c)}</Badge>
                      <button type="button" className="text-primary-600 hover:underline" onClick={() => openDetail(c.id)}>{c.title}</button>
                      <span className="ml-auto text-warm-500">{Math.round(c.progress)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {detail.reviewId && (
              <p className="text-xs text-warm-500">Linked to a performance review</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-warm-500">Loading goal...</p>
        )}
      </Modal>
    </div>
  );
}
