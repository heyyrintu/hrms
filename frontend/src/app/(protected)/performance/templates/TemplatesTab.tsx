'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { templatesApi, type BankQuestion, type ReviewTemplate } from '@/lib/api-performance-templates';
import type { ReviewAudience } from '@/lib/api-performance-reviews';
import { Plus, Edit2, Trash2, RefreshCw, ArrowUp, ArrowDown, X } from 'lucide-react';

interface EntryDraft { questionId: string; audience: ReviewAudience; isRequired: boolean }

const audienceLabels: Record<ReviewAudience, string> = { SELF: 'Self', MANAGER: 'Manager', PEER: 'Peer' };

function errorMessage(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}

export function TemplatesTab() {
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [bank, setBank] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReviewTemplate | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [entries, setEntries] = useState<EntryDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<ReviewTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [t, q] = await Promise.all([templatesApi.list(), templatesApi.listQuestions()]);
      setTemplates(t.data);
      setBank(q.data);
    } catch {
      setLoadError(true);
      toast.error('Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openEditor = (t?: ReviewTemplate) => {
    setEditing(t ?? null);
    setName(t?.name ?? '');
    setDescription(t?.description ?? '');
    setIsActive(t?.isActive ?? true);
    setEntries(
      t
        ? [...t.questions]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((e) => ({ questionId: e.questionId, audience: e.audience, isRequired: e.isRequired }))
        : [],
    );
    setModalOpen(true);
  };

  const patchEntry = (i: number, patch: Partial<EntryDraft>) =>
    setEntries((list) => list.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  const move = (i: number, delta: number) =>
    setEntries((list) => {
      const j = i + delta;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const questionText = (id: string) =>
    bank.find((q) => q.id === id)?.text ?? templates.flatMap((t) => t.questions).find((e) => e.questionId === id)?.question?.text ?? id;

  const canSave = !!name.trim() && entries.every((e) => !!e.questionId);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || undefined,
        isActive,
        questions: entries.map((e, i) => ({
          questionId: e.questionId,
          audience: e.audience,
          isRequired: e.isRequired,
          sortOrder: i,
        })),
      };
      if (editing) {
        await templatesApi.update(editing.id, body);
        toast.success('Template updated');
      } else {
        await templatesApi.create(body);
        toast.success('Template created');
      }
      setModalOpen(false);
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save template'));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await templatesApi.remove(deleting.id);
      toast.success('Template deleted');
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete template'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => openEditor()}>
          <Plus className="h-4 w-4 mr-2" />
          New template
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
            </div>
          ) : loadError ? (
            <div className="text-center py-12 space-y-3" role="alert">
              <p className="text-sm text-red-600">Failed to load templates.</p>
              <Button variant="secondary" onClick={load}>Retry</Button>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 text-warm-500">
              <p className="text-lg font-medium">No templates yet</p>
              <p className="text-sm">Create a template and attach it to a review cycle</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-warm-50">
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Template</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Questions</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id} className="border-b hover:bg-warm-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-warm-900">{t.name}</p>
                        {t.description && <p className="text-xs text-warm-500">{t.description}</p>}
                      </td>
                      <td className="px-4 py-3 text-warm-600">{t.questions.length}</td>
                      <td className="px-4 py-3">
                        <Badge variant={t.isActive ? 'success' : 'gray'}>{t.isActive ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            aria-label={`Edit ${t.name}`}
                            title="Edit"
                            onClick={() => openEditor(t)}
                            className="text-warm-500 hover:text-warm-700"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            aria-label={`Delete ${t.name}`}
                            title="Delete"
                            onClick={() => setDeleting(t)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Template' : 'New Template'}
        size="xl"
      >
        <div role="dialog" aria-label="Template editor" className="space-y-4">
          <div>
            <label htmlFor="tpl-name" className="block text-sm font-medium text-warm-700 mb-1">Template name</label>
            <input
              id="tpl-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label htmlFor="tpl-desc" className="block text-sm font-medium text-warm-700 mb-1">Description</label>
            <textarea
              id="tpl-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="tpl-active"
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="tpl-active" className="text-sm text-warm-700">Active</label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-warm-900">Questions</h4>
              <Button
                variant="secondary"
                onClick={() => setEntries((l) => [...l, { questionId: '', audience: 'SELF', isRequired: true }])}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add entry
              </Button>
            </div>
            {entries.length === 0 && <p className="text-sm text-warm-500">No questions in this template yet.</p>}
            {entries.map((e, i) => {
              const n = i + 1;
              const options = bank.filter((q) => q.isActive || q.id === e.questionId);
              return (
                <div key={i} className="border border-warm-200 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-warm-500 w-5">{n}.</span>
                    <select
                      aria-label={`Entry ${n} question`}
                      value={e.questionId}
                      onChange={(ev) => patchEntry(i, { questionId: ev.target.value })}
                      className="flex-1 px-2 py-2 border border-warm-300 rounded-lg text-sm"
                    >
                      <option value="">Select question...</option>
                      {options.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.text} ({q.type === 'RATING' ? 'rating' : 'text'})
                        </option>
                      ))}
                      {e.questionId && !options.some((q) => q.id === e.questionId) && (
                        <option value={e.questionId}>{questionText(e.questionId)}</option>
                      )}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 pl-7">
                    <select
                      aria-label={`Entry ${n} audience`}
                      value={e.audience}
                      onChange={(ev) => patchEntry(i, { audience: ev.target.value as ReviewAudience })}
                      className="px-2 py-1.5 border border-warm-300 rounded-lg text-sm"
                    >
                      {(Object.keys(audienceLabels) as ReviewAudience[]).map((a) => (
                        <option key={a} value={a}>{audienceLabels[a]}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-sm text-warm-700">
                      <input
                        type="checkbox"
                        aria-label={`Entry ${n} required`}
                        checked={e.isRequired}
                        onChange={(ev) => patchEntry(i, { isRequired: ev.target.checked })}
                        className="h-4 w-4"
                      />
                      Required
                    </label>
                    <div className="flex items-center gap-1 ml-auto">
                      <button
                        aria-label={`Move entry ${n} up`}
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        className="p-1 text-warm-500 hover:text-warm-800 disabled:opacity-30"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={`Move entry ${n} down`}
                        disabled={i === entries.length - 1}
                        onClick={() => move(i, 1)}
                        className="p-1 text-warm-500 hover:text-warm-800 disabled:opacity-30"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        aria-label={`Remove entry ${n}`}
                        onClick={() => setEntries((l) => l.filter((_, idx) => idx !== i))}
                        className="p-1 text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <ModalFooter>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving || !canSave}>
              {saving ? 'Saving...' : 'Save template'}
            </Button>
          </ModalFooter>
        </div>
      </Modal>

      <Modal isOpen={!!deleting} onClose={() => setDeleting(null)} title="Delete Template">
        <p className="text-sm text-warm-600">
          Delete &quot;{deleting?.name}&quot;? Cycles using it keep their question snapshot.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete}>Confirm delete</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
