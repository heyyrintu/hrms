'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ArrowDown, ArrowUp, EyeOff, ListOrdered, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  recruitmentApi,
  type PipelineStage,
  type PipelineStageCategory,
} from '@/lib/api-recruitment';
import { STAGE_CATEGORY_COLORS } from '@/components/recruitment/pipeline/StageBadge';

const CATEGORY_OPTIONS: Array<{ value: PipelineStageCategory; label: string }> = [
  { value: 'APPLIED', label: 'Applied' },
  { value: 'SCREENING', label: 'Screening' },
  { value: 'INTERVIEW', label: 'Interview' },
  { value: 'OFFER', label: 'Offer' },
  { value: 'HIRED', label: 'Hired' },
  { value: 'REJECTED', label: 'Rejected' },
];

interface EditableStage {
  id?: string;
  name: string;
  category: PipelineStageCategory;
  isActive: boolean;
}

function toEditable(stage: PipelineStage): EditableStage {
  return { id: stage.id, name: stage.name, category: stage.category, isActive: stage.isActive };
}

export default function PipelineStagesPage() {
  const [stages, setStages] = useState<EditableStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recruitmentApi.listStages();
      setStages(res.data.map(toEditable));
    } catch {
      toast.error('Failed to load pipeline stages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeStages = stages.filter((s) => s.isActive);
  const inactiveStages = stages.filter((s) => !s.isActive);

  const updateActive = (index: number, patch: Partial<EditableStage>) => {
    setStages((prev) => {
      const activeOnly = prev.filter((s) => s.isActive);
      const target = activeOnly[index];
      return prev.map((s) => (s === target ? { ...s, ...patch } : s));
    });
  };

  const moveActive = (index: number, direction: -1 | 1) => {
    setStages((prev) => {
      const active = prev.filter((s) => s.isActive);
      const inactive = prev.filter((s) => !s.isActive);
      const target = index + direction;
      if (target < 0 || target >= active.length) return prev;
      const reordered = [...active];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return [...reordered, ...inactive];
    });
  };

  const addStage = () => {
    setStages((prev) => [...prev, { name: 'New stage', category: 'INTERVIEW', isActive: true }]);
  };

  const deactivateStage = (index: number) => {
    setStages((prev) => {
      const active = prev.filter((s) => s.isActive);
      const inactive = prev.filter((s) => !s.isActive);
      const target = active[index];
      if (!target.id) {
        // Never-saved stage: just drop it.
        return [...active.filter((s) => s !== target), ...inactive];
      }
      return [
        ...active.filter((s) => s !== target),
        ...inactive,
        { ...target, isActive: false },
      ];
    });
  };

  const save = async () => {
    const toSave = stages.filter((s) => s.isActive);
    if (toSave.length === 0) {
      toast.error('At least one active stage is required');
      return;
    }
    setSaving(true);
    try {
      const res = await recruitmentApi.replaceStages(
        toSave.map((s) => ({ id: s.id, name: s.name.trim(), category: s.category })),
      );
      setStages(res.data.map(toEditable));
      toast.success('Pipeline stages saved');
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(axiosError.response?.data?.message || 'Failed to save pipeline stages');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-warm-900 sm:text-2xl">
            <ListOrdered className="h-6 w-6 text-primary-600" />
            Pipeline Stages
          </h1>
          <p className="mt-1 text-warm-600">
            The hiring stages every application moves through, in order
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button onClick={addStage} disabled={loading}>
            <Plus className="mr-2 h-4 w-4" />
            Add stage
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 py-5">
              {activeStages.length === 0 && (
                <p className="text-sm text-warm-500">No active stages. Add one to get started.</p>
              )}
              {activeStages.map((stage, index) => (
                <div
                  key={stage.id ?? `new-${index}`}
                  data-testid={`stage-row-${index}`}
                  className="flex flex-col gap-2 rounded-lg border border-warm-200 p-3 sm:flex-row sm:items-center"
                >
                  <span className="w-6 text-sm font-medium text-warm-400">{index + 1}</span>
                  <Input
                    value={stage.name}
                    onChange={(e) => updateActive(index, { name: e.target.value })}
                    className="sm:flex-1"
                    aria-label={`Stage ${index + 1} name`}
                  />
                  <Select
                    value={stage.category}
                    onChange={(e) => updateActive(index, { category: e.target.value as PipelineStageCategory })}
                    options={CATEGORY_OPTIONS}
                    aria-label={`Stage ${index + 1} category`}
                    className="sm:w-48"
                  />
                  <Badge variant={STAGE_CATEGORY_COLORS[stage.category]}>{stage.category}</Badge>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveActive(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move stage ${index + 1} up`}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => moveActive(index, 1)}
                      disabled={index === activeStages.length - 1}
                      aria-label={`Move stage ${index + 1} down`}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deactivateStage(index)}
                      aria-label={`Remove stage ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {inactiveStages.length > 0 && (
            <Card>
              <CardContent className="space-y-2 py-5">
                <p className="mb-2 flex items-center gap-2 text-sm font-medium text-warm-500">
                  <EyeOff className="h-4 w-4" /> Inactive (kept for history)
                </p>
                {inactiveStages.map((stage) => (
                  <div key={stage.id} className="flex items-center gap-3 text-sm text-warm-500">
                    <span>{stage.name}</span>
                    <Badge variant="gray">{stage.category}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
