'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Workflow,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { PickedUser, UserSearchPicker } from '@/components/approvals/UserSearchPicker';
import {
  APPROVER_TYPE_LABELS,
  USER_ROLE_LABELS,
  UpsertWorkflowPayload,
  WORKFLOW_ENTITY_LABELS,
  WORKFLOW_ENTITY_TYPES,
  workflowApi,
  WorkflowApproverType,
  WorkflowDefinitionView,
  WorkflowEntityType,
  WorkflowUserRole,
} from '@/lib/api-workflow';
import { cn } from '@/lib/utils';

const MAX_WORKFLOW_STEPS = 10;

/** Which condition a later step may carry, per request type. */
const AMOUNT_TYPES: WorkflowEntityType[] = ['EXPENSE', 'LOAN', 'PAYROLL_RUN'];
const DAYS_TYPES: WorkflowEntityType[] = ['LEAVE', 'COMP_OFF'];

const APPROVER_TYPES = Object.keys(APPROVER_TYPE_LABELS) as WorkflowApproverType[];
const USER_ROLES = Object.keys(USER_ROLE_LABELS) as WorkflowUserRole[];

/** Form state: numbers are strings because inputs hand back strings. */
interface DraftStep {
  key: string;
  name: string;
  approverType: WorkflowApproverType;
  approverUser: PickedUser | null;
  approverRole: '' | WorkflowUserRole;
  minAmount: string;
  minDays: string;
}

interface Draft {
  name: string;
  adminOverride: boolean;
  allowSelfApproval: boolean;
  steps: DraftStep[];
}

let keySeq = 0;
const nextKey = () => `step-${++keySeq}`;

function toDraft(view: WorkflowDefinitionView): Draft {
  return {
    name: view.name,
    adminOverride: view.adminOverride,
    allowSelfApproval: view.allowSelfApproval,
    steps: [...view.steps]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        key: nextKey(),
        name: s.name,
        approverType: s.approverType,
        approverUser: s.approverUserId
          ? { id: s.approverUserId, name: s.approverUserName ?? s.approverUserId }
          : null,
        approverRole: s.approverRole ?? '',
        minAmount: s.minAmount == null ? '' : String(s.minAmount),
        minDays: s.minDays == null ? '' : String(s.minDays),
      })),
  };
}

const parseCondition = (value: string): number | null =>
  value.trim() === '' ? null : Number(value);

/** Build the PUT body; returns an error message instead when the draft is invalid. */
function buildPayload(
  entityType: WorkflowEntityType,
  draft: Draft,
): UpsertWorkflowPayload | string {
  if (draft.steps.length === 0) return 'Add at least one step';
  if (draft.steps.length > MAX_WORKFLOW_STEPS) {
    return `A workflow can have at most ${MAX_WORKFLOW_STEPS} steps`;
  }

  const usesAmount = AMOUNT_TYPES.includes(entityType);
  const usesDays = DAYS_TYPES.includes(entityType);
  const steps: UpsertWorkflowPayload['steps'] = [];

  for (const [index, step] of draft.steps.entries()) {
    const label = `Step ${index + 1}`;
    if (!step.name.trim()) return `${label} needs a name`;
    if (step.approverType === 'SPECIFIC_USER' && !step.approverUser) {
      return `${label}: pick the user who approves`;
    }
    if (step.approverType === 'ROLE' && !step.approverRole) {
      return `${label}: pick the role that approves`;
    }

    // Step 1 always runs, so it never carries a condition.
    const minAmount = index > 0 && usesAmount ? parseCondition(step.minAmount) : null;
    const minDays = index > 0 && usesDays ? parseCondition(step.minDays) : null;
    if (minAmount != null && (Number.isNaN(minAmount) || minAmount < 0)) {
      return `${label}: minimum amount must be zero or more`;
    }
    if (minDays != null && (Number.isNaN(minDays) || minDays < 0)) {
      return `${label}: minimum days must be zero or more`;
    }

    steps.push({
      name: step.name.trim(),
      approverType: step.approverType,
      approverUserId:
        step.approverType === 'SPECIFIC_USER' ? step.approverUser?.id ?? null : null,
      approverRole: step.approverType === 'ROLE' ? step.approverRole || null : null,
      minAmount,
      minDays,
    });
  }

  return {
    name: draft.name.trim() || `${WORKFLOW_ENTITY_LABELS[entityType]} approval`,
    adminOverride: draft.adminOverride,
    allowSelfApproval: draft.allowSelfApproval,
    steps,
  };
}

export default function WorkflowBuilderPage() {
  const [definitions, setDefinitions] = useState<
    Partial<Record<WorkflowEntityType, WorkflowDefinitionView>>
  >({});
  const [drafts, setDrafts] = useState<Partial<Record<WorkflowEntityType, Draft>>>({});
  const [selected, setSelected] = useState<WorkflowEntityType>('LEAVE');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const applyView = (view: WorkflowDefinitionView) => {
    setDefinitions((prev) => ({ ...prev, [view.entityType]: view }));
    setDrafts((prev) => ({ ...prev, [view.entityType]: toDraft(view) }));
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await workflowApi.listDefinitions();
      const views = res.data ?? [];
      setDefinitions(Object.fromEntries(views.map((v) => [v.entityType, v])));
      setDrafts(Object.fromEntries(views.map((v) => [v.entityType, toDraft(v)])));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to load approval workflows');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const definition = definitions[selected];
  const draft = drafts[selected];
  const usesAmount = AMOUNT_TYPES.includes(selected);
  const usesDays = DAYS_TYPES.includes(selected);

  const updateDraft = (fn: (d: Draft) => Draft) =>
    setDrafts((prev) => {
      const current = prev[selected];
      return current ? { ...prev, [selected]: fn(current) } : prev;
    });

  const updateStep = (key: string, patch: Partial<DraftStep>) =>
    updateDraft((d) => ({
      ...d,
      steps: d.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    }));

  const addStep = () =>
    updateDraft((d) => ({
      ...d,
      steps: [
        ...d.steps,
        {
          key: nextKey(),
          name: `Step ${d.steps.length + 1}`,
          approverType: 'HR_ADMIN',
          approverUser: null,
          approverRole: '',
          minAmount: '',
          minDays: '',
        },
      ],
    }));

  const removeStep = (key: string) =>
    updateDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.key !== key) }));

  const moveStep = (index: number, delta: -1 | 1) =>
    updateDraft((d) => {
      const target = index + delta;
      if (target < 0 || target >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...d, steps };
    });

  const handleSave = async () => {
    if (!draft) return;
    const payload = buildPayload(selected, draft);
    if (typeof payload === 'string') {
      toast.error(payload);
      return;
    }
    setSaving(true);
    try {
      const res = await workflowApi.saveDefinition(selected, payload);
      applyView(res.data);
      toast.success(`${WORKFLOW_ENTITY_LABELS[selected]} workflow saved`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to save the workflow');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !window.confirm(
        `Reset the ${WORKFLOW_ENTITY_LABELS[selected]} workflow to the built-in default? Requests already in progress keep their current chain.`,
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      const res = await workflowApi.resetDefinition(selected);
      applyView(res.data);
      toast.success(`${WORKFLOW_ENTITY_LABELS[selected]} workflow reset to default`);
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to reset the workflow');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
            <Workflow className="w-7 h-7 text-primary-600" />
            Approval Workflows
          </h1>
          <p className="text-warm-500">
            Who approves each kind of request, and in what order. Changes apply to new
            requests only.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div role="tablist" aria-label="Request type" className="flex flex-wrap gap-2">
        {WORKFLOW_ENTITY_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={selected === t}
            onClick={() => setSelected(t)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
              selected === t
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-warm-200 bg-white text-warm-600 hover:bg-warm-50',
            )}
          >
            {WORKFLOW_ENTITY_LABELS[t]}
            {definitions[t]?.isCustom && (
              <span className="h-1.5 w-1.5 rounded-full bg-primary-500" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {loading && !draft ? (
        <p className="text-warm-500">Loading...</p>
      ) : !draft || !definition ? (
        <p className="text-warm-500">This workflow could not be loaded.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{WORKFLOW_ENTITY_LABELS[selected]} approval</CardTitle>
                <Badge variant={definition.isCustom ? 'default' : 'gray'}>
                  {definition.isCustom ? 'Custom' : 'Default'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Workflow name"
                maxLength={120}
                value={draft.name}
                onChange={(e) => updateDraft((d) => ({ ...d, name: e.target.value }))}
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.adminOverride}
                  onChange={(e) =>
                    updateDraft((d) => ({ ...d, adminOverride: e.target.checked }))
                  }
                />
                <span>HR admins can approve any step (override)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.allowSelfApproval}
                  onChange={(e) =>
                    updateDraft((d) => ({ ...d, allowSelfApproval: e.target.checked }))
                  }
                />
                <span>Allow the requester to approve their own request</span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Steps</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {draft.steps.length === 0 && (
                <p className="text-sm text-warm-500">No steps yet. Add at least one.</p>
              )}
              <ol className="space-y-4">
                {draft.steps.map((step, index) => {
                  const n = index + 1;
                  return (
                    <li
                      key={step.key}
                      className="rounded-lg border border-warm-200 p-4 space-y-3"
                      data-testid={`workflow-step-${n}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-warm-700">Step {n}</span>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => moveStep(index, -1)}
                            disabled={index === 0}
                            aria-label={`Move step ${n} up`}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => moveStep(index, 1)}
                            disabled={index === draft.steps.length - 1}
                            aria-label={`Move step ${n} down`}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeStep(step.key)}
                            aria-label={`Remove step ${n}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Input
                          label={`Step ${n} name`}
                          maxLength={120}
                          value={step.name}
                          onChange={(e) => updateStep(step.key, { name: e.target.value })}
                        />
                        <Select
                          id={`${step.key}-approver-type`}
                          label={`Step ${n} approver`}
                          value={step.approverType}
                          onChange={(e) =>
                            updateStep(step.key, {
                              approverType: e.target.value as WorkflowApproverType,
                            })
                          }
                        >
                          {APPROVER_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {APPROVER_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </Select>
                      </div>
                      {step.approverType === 'SPECIFIC_USER' && (
                        <UserSearchPicker
                          label={`Step ${n} user`}
                          value={step.approverUser}
                          onChange={(u) => updateStep(step.key, { approverUser: u })}
                        />
                      )}
                      {step.approverType === 'ROLE' && (
                        <Select
                          id={`${step.key}-role`}
                          label={`Step ${n} role`}
                          value={step.approverRole}
                          onChange={(e) =>
                            updateStep(step.key, {
                              approverRole: e.target.value as DraftStep['approverRole'],
                            })
                          }
                        >
                          <option value="">Choose a role</option>
                          {USER_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {USER_ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      )}
                      {index > 0 && usesAmount && (
                        <Input
                          label={`Step ${n} only when amount is at least`}
                          type="number"
                          min={0}
                          step="0.01"
                          placeholder="Always"
                          value={step.minAmount}
                          onChange={(e) => updateStep(step.key, { minAmount: e.target.value })}
                        />
                      )}
                      {index > 0 && usesDays && (
                        <Input
                          label={`Step ${n} only when days are at least`}
                          type="number"
                          min={0}
                          step="0.5"
                          placeholder="Always"
                          value={step.minDays}
                          onChange={(e) => updateStep(step.key, { minDays: e.target.value })}
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
              <Button
                variant="secondary"
                onClick={addStep}
                disabled={draft.steps.length >= MAX_WORKFLOW_STEPS}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add step
              </Button>
              {(usesAmount || usesDays) && (
                <p className="text-sm text-warm-500">
                  Step 1 always runs. A later step with a condition is skipped when the
                  request is below it; leave the box blank to always run the step.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button
              variant="secondary"
              onClick={handleReset}
              loading={resetting}
              disabled={!definition.isCustom || saving}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset to default
            </Button>
            <Button onClick={handleSave} loading={saving} disabled={resetting}>
              <Save className="h-4 w-4 mr-2" />
              Save workflow
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
