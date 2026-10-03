'use client';

import { useState } from 'react';
import { Pencil, Trash2, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { goalsApi } from '@/lib/api-performance-goals';
import type { KeyResult, KeyResultInput, KeyResultMetricType } from '@/lib/api-performance-goals';

interface Props {
  goalId: string;
  keyResults: KeyResult[];
  canEdit: boolean;
  onChanged: () => void;
}

interface Draft {
  title: string;
  metricType: KeyResultMetricType;
  startValue: string;
  targetValue: string;
  currentValue: string;
  unit: string;
}

const emptyDraft: Draft = { title: '', metricType: 'NUMBER', startValue: '0', targetValue: '', currentValue: '0', unit: '' };

function toDraft(kr: KeyResult): Draft {
  return {
    title: kr.title,
    metricType: kr.metricType,
    startValue: String(kr.startValue),
    targetValue: String(kr.targetValue),
    currentValue: String(kr.currentValue),
    unit: kr.unit ?? '',
  };
}

function toInput(d: Draft): KeyResultInput {
  const boolean = d.metricType === 'BOOLEAN';
  return {
    title: d.title.trim(),
    metricType: d.metricType,
    startValue: boolean ? 0 : Number(d.startValue),
    targetValue: boolean ? 1 : Number(d.targetValue),
    currentValue: Number(d.currentValue),
    ...(d.unit.trim() ? { unit: d.unit.trim() } : {}),
  };
}

export function KeyResultEditor({ goalId, keyResults, canEdit, onChanged }: Props) {
  // editingId: a key result id, 'new', or null.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  const startEdit = (kr: KeyResult) => {
    setDraft(toDraft(kr));
    setEditingId(kr.id);
  };
  const startAdd = () => {
    setDraft(emptyDraft);
    setEditingId('new');
  };

  const valid =
    draft.title.trim().length > 0 &&
    (draft.metricType === 'BOOLEAN' || (draft.targetValue !== '' && !Number.isNaN(Number(draft.targetValue))));

  const save = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      if (editingId === 'new') await goalsApi.addKeyResult(goalId, toInput(draft));
      else await goalsApi.updateKeyResult(goalId, editingId, toInput(draft));
      toast.success('Key result saved');
      setEditingId(null);
      onChanged();
    } catch {
      toast.error('Failed to save key result');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kr: KeyResult) => {
    try {
      await goalsApi.removeKeyResult(goalId, kr.id);
      toast.success('Key result removed');
      onChanged();
    } catch {
      toast.error('Failed to remove key result');
    }
  };

  const toggleBoolean = async (kr: KeyResult, done: boolean) => {
    try {
      await goalsApi.updateKeyResult(goalId, kr.id, { currentValue: done ? 1 : 0 });
      onChanged();
    } catch {
      toast.error('Failed to update key result');
    }
  };

  const form = (
    <div className="rounded-lg border border-warm-200 p-3 space-y-3 bg-warm-50">
      <Input label="Key result title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
      <Select
        label="Metric type"
        value={draft.metricType}
        onChange={(e) => setDraft({ ...draft, metricType: e.target.value as KeyResultMetricType })}
        options={[
          { value: 'NUMBER', label: 'Number' },
          { value: 'PERCENT', label: 'Percent' },
          { value: 'CURRENCY', label: 'Currency' },
          { value: 'BOOLEAN', label: 'Yes / No' },
        ]}
      />
      {draft.metricType === 'BOOLEAN' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={Number(draft.currentValue) >= 1}
            onChange={(e) => setDraft({ ...draft, currentValue: e.target.checked ? '1' : '0' })}
          />
          Done
        </label>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <Input label="Start value" type="number" value={draft.startValue} onChange={(e) => setDraft({ ...draft, startValue: e.target.value })} />
          <Input label="Current value" type="number" value={draft.currentValue} onChange={(e) => setDraft({ ...draft, currentValue: e.target.value })} />
          <Input label="Target value" type="number" value={draft.targetValue} onChange={(e) => setDraft({ ...draft, targetValue: e.target.value })} />
        </div>
      )}
      {draft.metricType !== 'BOOLEAN' && (
        <Input label="Unit" value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} />
      )}
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={!valid || saving}>Save</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      {keyResults.length === 0 && editingId !== 'new' && <p className="text-sm text-warm-500">No key results yet.</p>}
      {keyResults.map((kr) =>
        editingId === kr.id ? (
          <div key={kr.id}>{form}</div>
        ) : (
          <div key={kr.id} className="flex items-center gap-3 rounded-lg border border-warm-200 px-3 py-2">
            {kr.metricType === 'BOOLEAN' && (
              <input
                type="checkbox"
                aria-label={`Done: ${kr.title}`}
                checked={kr.currentValue >= 1}
                disabled={!canEdit}
                onChange={(e) => toggleBoolean(kr, e.target.checked)}
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-warm-900">{kr.title}</p>
              {kr.metricType !== 'BOOLEAN' && (
                <p className="text-xs text-warm-500">
                  {kr.currentValue} / {kr.targetValue}
                  {kr.metricType === 'PERCENT' ? '%' : kr.unit ? ` ${kr.unit}` : ''} ({Math.round(kr.progress)}%)
                </p>
              )}
            </div>
            {canEdit && (
              <>
                <button type="button" aria-label={`Edit key result ${kr.title}`} onClick={() => startEdit(kr)} className="p-1.5 rounded hover:bg-warm-100 text-warm-500">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" aria-label={`Delete key result ${kr.title}`} onClick={() => remove(kr)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ),
      )}
      {editingId === 'new' && form}
      {canEdit && editingId === null && (
        <Button variant="secondary" size="sm" onClick={startAdd}>
          <Plus className="h-4 w-4 mr-1" /> Add key result
        </Button>
      )}
    </div>
  );
}
