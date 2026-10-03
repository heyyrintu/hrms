'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { templatesApi, type BankQuestion } from '@/lib/api-performance-templates';
import type { ReviewQuestionType } from '@/lib/api-performance-reviews';
import { Plus, Edit2, Trash2, RefreshCw } from 'lucide-react';

function errorMessage(e: unknown, fallback: string): string {
  const msg = (e as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return (Array.isArray(msg) ? msg.join(', ') : msg) || fallback;
}

export function QuestionBankTab() {
  const [questions, setQuestions] = useState<BankQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BankQuestion | null>(null);
  const [text, setText] = useState('');
  const [type, setType] = useState<ReviewQuestionType>('TEXT');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<BankQuestion | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await templatesApi.listQuestions();
      setQuestions(res.data);
    } catch {
      toast.error('Failed to load the question bank');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openModal = (q?: BankQuestion) => {
    setEditing(q ?? null);
    setText(q?.text ?? '');
    setType(q?.type ?? 'TEXT');
    setCategory(q?.category ?? '');
    setModalOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { text: text.trim(), type, category: category.trim() || undefined };
      if (editing) {
        await templatesApi.updateQuestion(editing.id, body);
        toast.success('Question updated');
      } else {
        await templatesApi.createQuestion(body);
        toast.success('Question added');
      }
      setModalOpen(false);
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to save question'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (q: BankQuestion) => {
    try {
      await templatesApi.updateQuestion(q.id, { isActive: !q.isActive });
      toast.success(q.isActive ? 'Question deactivated' : 'Question activated');
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to update question'));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await templatesApi.removeQuestion(deleting.id);
      toast.success('Question deleted');
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e, 'Failed to delete question'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => openModal()}>
          <Plus className="h-4 w-4 mr-2" />
          Add question
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-warm-400" />
            </div>
          ) : questions.length === 0 ? (
            <div className="text-center py-12 text-warm-500">
              <p className="text-lg font-medium">No questions yet</p>
              <p className="text-sm">Add questions to build review templates</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-warm-50">
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Question</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Category</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Templates</th>
                    <th className="text-left px-4 py-3 font-medium text-warm-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => (
                    <tr key={q.id} className="border-b hover:bg-warm-50">
                      <td className="px-4 py-3 font-medium text-warm-900">{q.text}</td>
                      <td className="px-4 py-3 text-warm-600">{q.type === 'RATING' ? 'Rating' : 'Text'}</td>
                      <td className="px-4 py-3 text-warm-600">{q.category ?? '-'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={q.isActive ? 'success' : 'gray'}>{q.isActive ? 'Active' : 'Inactive'}</Badge>
                      </td>
                      <td className="px-4 py-3 text-warm-600">{q.usedByTemplates}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <button
                            aria-label={`Edit ${q.text}`}
                            title="Edit"
                            onClick={() => openModal(q)}
                            className="text-warm-500 hover:text-warm-700"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            aria-label={`${q.isActive ? 'Deactivate' : 'Activate'} ${q.text}`}
                            onClick={() => toggleActive(q)}
                            className="text-xs text-primary-600 hover:underline"
                          >
                            {q.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            aria-label={`Delete ${q.text}`}
                            title={q.usedByTemplates > 0 ? 'Used by a template — deactivate instead' : 'Delete'}
                            disabled={q.usedByTemplates > 0}
                            onClick={() => setDeleting(q)}
                            className="text-red-500 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
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

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Question' : 'Add Question'}>
        <div className="space-y-4">
          <div>
            <label htmlFor="bank-text" className="block text-sm font-medium text-warm-700 mb-1">Question text</label>
            <textarea
              id="bank-text"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="bank-type" className="block text-sm font-medium text-warm-700 mb-1">Answer type</label>
              <select
                id="bank-type"
                value={type}
                onChange={(e) => setType(e.target.value as ReviewQuestionType)}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg"
              >
                <option value="TEXT">Text</option>
                <option value="RATING">Rating (1-5)</option>
              </select>
            </div>
            <div>
              <label htmlFor="bank-category" className="block text-sm font-medium text-warm-700 mb-1">Category</label>
              <input
                id="bank-category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-warm-300 rounded-lg"
              />
            </div>
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || !text.trim()}>
            {saving ? 'Saving...' : 'Save question'}
          </Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={!!deleting} onClose={() => setDeleting(null)} title="Delete Question">
        <p className="text-sm text-warm-600">
          Delete &quot;{deleting?.text}&quot;? This cannot be undone.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" onClick={confirmDelete}>Confirm delete</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
