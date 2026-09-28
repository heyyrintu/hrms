'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { recognitionApi, type Badge } from '@/lib/api-recognition';
import { Plus, Pencil, Power } from 'lucide-react';
import toast from 'react-hot-toast';

const emptyForm = { name: '', description: '', icon: '', points: '0' };

function errorMessage(err: unknown, fallback: string): string {
  const axiosError = err as { response?: { data?: { message?: string } } };
  return axiosError.response?.data?.message || fallback;
}

/** HR: the badge catalog — list, create/edit, deactivate. */
export function BadgeManager() {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Badge | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recognitionApi.badges(true);
      setBadges(res.data?.data ?? res.data ?? []);
    } catch {
      toast.error('Failed to load badges');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = (badge: Badge) => {
    setEditing(badge);
    setForm({
      name: badge.name,
      description: badge.description ?? '',
      icon: badge.icon,
      points: String(badge.points),
    });
    setFormOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.icon.trim()) {
      toast.error('Name and icon are required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        icon: form.icon.trim(),
        points: Number(form.points) || 0,
      };
      if (editing) {
        await recognitionApi.updateBadge(editing.id, payload);
        toast.success('Badge updated');
      } else {
        await recognitionApi.createBadge(payload);
        toast.success('Badge created');
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save the badge'));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (badge: Badge) => {
    try {
      await recognitionApi.deactivateBadge(badge.id);
      toast.success('Badge deactivated');
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to deactivate the badge'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Badge
        </Button>
      </div>

      {loading ? (
        <p className="text-warm-500">Loading badges…</p>
      ) : badges.length === 0 ? (
        <p className="text-warm-500">No badges yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {badges.map((badge) => (
            <div key={badge.id} data-testid={`badge-${badge.id}`}>
            <Card>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium text-warm-900">
                    {badge.icon} {badge.name}
                    {!badge.isActive && (
                      <span className="ml-2 text-xs text-warm-400">(inactive)</span>
                    )}
                  </p>
                  {badge.description && (
                    <p className="text-sm text-warm-500">{badge.description}</p>
                  )}
                  <p className="text-sm text-warm-500">{badge.points} points</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openEdit(badge)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {badge.isActive && (
                    <Button variant="danger" size="sm" onClick={() => deactivate(badge)}>
                      <Power className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit Badge' : 'New Badge'}
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            maxLength={50}
          />
          <Input
            label="Icon (an emoji)"
            value={form.icon}
            onChange={(e) => setForm({ ...form, icon: e.target.value })}
            maxLength={8}
          />
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={500}
          />
          <Input
            label="Points"
            type="number"
            min={0}
            max={1000}
            value={form.points}
            onChange={(e) => setForm({ ...form, points: e.target.value })}
          />
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Save
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
