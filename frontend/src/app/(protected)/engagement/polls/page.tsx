'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { pollsApi, type Poll } from '@/lib/api-polls';
import { Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

const emptyForm = () => ({
  question: '',
  options: ['', ''],
  closesAt: '',
});

export default function EngagementPollsPage() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<Poll | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await pollsApi.list();
      setPolls(res.data.data);
    } catch {
      toast.error('Failed to load polls');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateOption = (index: number, value: string) => {
    setForm((prev) => ({
      ...prev,
      options: prev.options.map((o, i) => (i === index ? value : o)),
    }));
  };

  const addOption = () => {
    setForm((prev) =>
      prev.options.length >= MAX_OPTIONS ? prev : { ...prev, options: [...prev.options, ''] },
    );
  };

  const removeOption = (index: number) => {
    setForm((prev) =>
      prev.options.length <= MIN_OPTIONS
        ? prev
        : { ...prev, options: prev.options.filter((_, i) => i !== index) },
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await pollsApi.create({
        question: form.question,
        options: form.options.map((o) => o.trim()).filter((o) => o.length > 0),
        // datetime-local gives a zone-less `YYYY-MM-DDTHH:mm`; pin it to IST so
        // the server does not read it in its own zone.
        closesAt: form.closesAt ? `${form.closesAt}:00+05:30` : undefined,
      });
      toast.success('Poll created');
      setFormOpen(false);
      setForm(emptyForm());
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to create the poll');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async (poll: Poll) => {
    try {
      await pollsApi.close(poll.id);
      toast.success('Poll closed');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to close the poll');
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await pollsApi.remove(deleting.id);
      toast.success('Poll deleted');
      setDeleting(null);
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to delete the poll');
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-warm-900">Polls</h1>
          <p className="text-warm-500">Quick single-choice polls, visible to the whole company.</p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New poll
        </Button>
      </div>

      {polls.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-warm-500">No polls yet.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {polls.map((poll) => {
            const total = poll.totalVotes ?? 0;
            return (
              <Card key={poll.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-warm-900">{poll.question}</p>
                        <Badge variant={poll.status === 'ACTIVE' ? 'success' : 'gray'}>
                          {poll.status === 'ACTIVE' ? 'Active' : 'Closed'}
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-1.5">
                        {poll.options.map((option) => {
                          const count = option.voteCount ?? 0;
                          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                          return (
                            <div key={option.id} className="text-sm">
                              <div className="flex justify-between text-warm-600">
                                <span>{option.label}</span>
                                <span>
                                  {count} vote{count === 1 ? '' : 's'} ({pct}%)
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-warm-100 overflow-hidden">
                                <div className="h-full bg-primary-500" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                        {(poll.pendingVotes ?? 0) > 0 && (
                          <p className="text-xs text-warm-400">
                            Some votes are still being counted
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      {poll.status === 'ACTIVE' && (
                        <Button
                          variant="secondary"
                          className="h-8 px-3 text-sm"
                          onClick={() => handleClose(poll)}
                        >
                          Close
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        className="h-8 px-3 text-sm flex items-center gap-1"
                        onClick={() => setDeleting(poll)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Modal isOpen={formOpen} onClose={() => setFormOpen(false)} title="New poll">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Question"
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            required
            maxLength={300}
          />

          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1.5">Options</label>
            <div className="space-y-2">
              {form.options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    aria-label={`Option ${index + 1}`}
                    className="input flex-1"
                    value={option}
                    onChange={(e) => updateOption(index, e.target.value)}
                    maxLength={100}
                    required
                  />
                  {form.options.length > MIN_OPTIONS && (
                    <button
                      type="button"
                      aria-label={`Remove option ${index + 1}`}
                      onClick={() => removeOption(index)}
                      className="text-warm-400 hover:text-warm-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {form.options.length < MAX_OPTIONS && (
              <button
                type="button"
                onClick={addOption}
                className="mt-2 text-sm text-primary-600 hover:underline flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add option
              </button>
            )}
          </div>

          <Input
            label="Closes at (optional)"
            type="datetime-local"
            value={form.closesAt}
            onChange={(e) => setForm({ ...form, closesAt: e.target.value })}
          />

          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Create poll
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal isOpen={!!deleting} onClose={() => setDeleting(null)} title="Delete poll?" size="sm">
        <p className="text-sm text-warm-600">
          This permanently deletes &quot;{deleting?.question}&quot; and all of its votes.
        </p>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
