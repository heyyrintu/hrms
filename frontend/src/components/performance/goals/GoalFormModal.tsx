'use client';

import { useEffect, useState } from 'react';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { departmentsApi } from '@/lib/api';
import { goalsApi } from '@/lib/api-performance-goals';
import { reviewsApi } from '@/lib/api-performance-reviews';
import type { Goal, GoalInput, GoalOwnerType, GoalStatus } from '@/lib/api-performance-goals';
import { asList, ownerLabel, toDateInput } from './goal-utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: GoalInput, goalId?: string) => Promise<void> | void;
  goal: Goal | null;
  isAdmin: boolean;
  initialOwnerType?: GoalOwnerType;
}

interface Form {
  ownerType: GoalOwnerType;
  title: string;
  description: string;
  targetDate: string;
  weight: string;
  departmentId: string;
  parentGoalId: string;
  reviewId: string;
  shareOnFeed: boolean;
  status: GoalStatus;
  progress: string;
}

interface ReviewOption {
  id: string;
  cycle: { name: string; status: string };
}

function initialForm(goal: Goal | null, ownerType: GoalOwnerType): Form {
  return {
    ownerType: goal?.ownerType ?? ownerType,
    title: goal?.title ?? '',
    description: goal?.description ?? '',
    targetDate: toDateInput(goal?.targetDate),
    weight: String(goal?.weight ?? 1),
    departmentId: goal?.departmentId ?? '',
    parentGoalId: goal?.parentGoalId ?? '',
    reviewId: goal?.reviewId ?? '',
    shareOnFeed: goal?.shareOnFeed ?? false,
    status: goal?.status ?? 'NOT_STARTED',
    progress: String(goal?.progress ?? 0),
  };
}

async function attempt<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export function GoalFormModal({ isOpen, onClose, onSave, goal, isAdmin, initialOwnerType = 'EMPLOYEE' }: Props) {
  // A non-admin can only ever create employee goals, whatever the caller asks for.
  const startType: GoalOwnerType = isAdmin ? initialOwnerType : 'EMPLOYEE';
  const [form, setForm] = useState<Form>(() => initialForm(goal, startType));
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [parents, setParents] = useState<Goal[]>([]);
  const [reviews, setReviews] = useState<ReviewOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) setForm(initialForm(goal, startType));
  }, [isOpen, goal, startType]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const [dept, company, department, team, mine] = await Promise.all([
        attempt(departmentsApi.getAll()),
        attempt(goalsApi.list({ scope: 'company' })),
        attempt(goalsApi.list({ scope: 'department' })),
        attempt(goalsApi.list({ scope: 'team' })),
        attempt(reviewsApi.myReviews()),
      ]);
      if (cancelled) return;
      setDepartments(asList<{ id: string; name: string }>(dept?.data));
      const seen = new Set<string>();
      const all: Goal[] = [];
      for (const r of [company, department, team]) {
        for (const g of r?.data ?? []) {
          if (!seen.has(g.id) && g.id !== goal?.id) {
            seen.add(g.id);
            all.push(g);
          }
        }
      }
      setParents(all);
      const rv = asList<ReviewOption>((mine?.data as unknown as { data?: unknown } | undefined)?.data);
      setReviews(rv.filter((r) => r.cycle?.status !== 'COMPLETED'));
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, goal?.id]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const isEmployeeGoal = form.ownerType === 'EMPLOYEE';
  const derived = goal?.isDerived === true;
  const weight = Number(form.weight);
  const valid =
    form.title.trim().length > 0 &&
    form.targetDate !== '' &&
    weight > 0 &&
    (form.ownerType !== 'DEPARTMENT' || form.departmentId !== '');

  const submit = async () => {
    const payload: GoalInput = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      targetDate: form.targetDate,
      weight,
      parentGoalId: form.parentGoalId || null,
    };
    if (!goal) {
      payload.ownerType = form.ownerType;
      if (form.ownerType === 'DEPARTMENT') payload.departmentId = form.departmentId;
    }
    if (isEmployeeGoal) {
      payload.reviewId = form.reviewId || null;
      payload.shareOnFeed = form.shareOnFeed;
    }
    if (!derived) {
      payload.status = form.status;
      payload.progress = Number(form.progress);
    }
    setSaving(true);
    try {
      await onSave(payload, goal?.id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={goal ? 'Edit goal' : 'New goal'} size="lg">
      <div className="space-y-4">
        {isAdmin && !goal && (
          <Select
            label="Owner type"
            value={form.ownerType}
            onChange={(e) => set('ownerType', e.target.value as GoalOwnerType)}
            options={[
              { value: 'EMPLOYEE', label: 'Employee' },
              { value: 'DEPARTMENT', label: 'Department' },
              { value: 'COMPANY', label: 'Company' },
            ]}
          />
        )}
        {form.ownerType === 'DEPARTMENT' && (
          <Select
            label="Department"
            value={form.departmentId}
            disabled={!!goal}
            onChange={(e) => set('departmentId', e.target.value)}
            placeholder="Select department"
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
        )}
        <Input label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} />
        <div>
          <label htmlFor="goal-description" className="label">Description</label>
          <textarea
            id="goal-description"
            className="input min-h-[80px]"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Target date" type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} />
          <Input label="Weight" type="number" min={1} value={form.weight} onChange={(e) => set('weight', e.target.value)} />
        </div>
        <Select
          label="Parent goal"
          value={form.parentGoalId}
          onChange={(e) => set('parentGoalId', e.target.value)}
          placeholder="No parent"
          options={parents.map((p) => ({ value: p.id, label: `${ownerLabel(p)} - ${p.title}` }))}
        />
        {isEmployeeGoal && (
          <Select
            label="Linked review"
            value={form.reviewId}
            onChange={(e) => set('reviewId', e.target.value)}
            placeholder="Not linked"
            options={reviews.map((r) => ({ value: r.id, label: r.cycle.name }))}
          />
        )}
        {isEmployeeGoal && (
          <label className="flex items-center gap-2 text-sm text-warm-700">
            <input type="checkbox" checked={form.shareOnFeed} onChange={(e) => set('shareOnFeed', e.target.checked)} />
            Share on the company feed when completed
          </label>
        )}
        {!derived && (
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Status"
              value={form.status}
              onChange={(e) => set('status', e.target.value as GoalStatus)}
              options={[
                { value: 'NOT_STARTED', label: 'Not started' },
                { value: 'IN_PROGRESS', label: 'In progress' },
                { value: 'COMPLETED', label: 'Completed' },
              ]}
            />
            <Input
              label="Progress (%)"
              type="number"
              min={0}
              max={100}
              value={form.progress}
              onChange={(e) => set('progress', e.target.value)}
            />
          </div>
        )}
        {derived && <p className="text-xs text-warm-500">Progress and status are calculated from key results or child goals.</p>}
      </div>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!valid || saving}>{goal ? 'Save changes' : 'Create goal'}</Button>
      </ModalFooter>
    </Modal>
  );
}
