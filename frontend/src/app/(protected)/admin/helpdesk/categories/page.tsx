'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { helpdeskApi, type TicketCategory } from '@/lib/api-helpdesk';
import { Tags, Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const emptyForm = {
  name: '',
  code: '',
  description: '',
  slaHours: '48',
  isActive: true,
};

type FormState = typeof emptyForm;

const formFor = (category: TicketCategory): FormState => ({
  name: category.name,
  code: category.code,
  description: category.description ?? '',
  slaHours: String(category.slaHours),
  isActive: category.isActive,
});

/**
 * Helpdesk categories and their SLA. Nothing is seeded, so an empty tenant
 * starts here before anyone can raise a ticket.
 */
export default function HelpdeskCategoriesPage() {
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TicketCategory | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await helpdeskApi.getCategories(true);
      setCategories(res.data ?? []);
    } catch {
      toast.error('Failed to load categories');
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
    setModalOpen(true);
  };

  const openEdit = (category: TicketCategory) => {
    setEditing(category);
    setForm(formFor(category));
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error('Name and code are required');
      return;
    }
    const slaHours = Number(form.slaHours);
    if (!Number.isFinite(slaHours) || slaHours < 1) {
      toast.error('SLA hours must be a positive number');
      return;
    }

    setSaving(true);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: form.description.trim() || undefined,
      slaHours,
      isActive: form.isActive,
    };

    try {
      if (editing) {
        await helpdeskApi.updateCategory(editing.id, payload);
        toast.success('Category updated');
      } else {
        await helpdeskApi.createCategory(payload);
        toast.success('Category created');
      }
      setModalOpen(false);
      await load();
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      toast.error(
        status === 409 ? 'That code is already in use' : 'Failed to save category',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-warm-900 flex items-center gap-2">
            <Tags className="h-6 w-6" />
            Helpdesk categories
          </h1>
          <p className="text-sm text-warm-600">
            Each category carries the SLA a ticket raised against it is held to.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/helpdesk">Queue</Link>
          <Button variant="secondary" onClick={load} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" />
            New category
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          {loading ? (
            <p className="text-sm text-warm-600">Loading categories...</p>
          ) : categories.length === 0 ? (
            <p className="text-sm text-warm-600">
              No categories yet. Add one before employees can raise tickets.
            </p>
          ) : (
            <ul className="divide-y divide-warm-200">
              {categories.map((category) => (
                <li
                  key={category.id}
                  className="flex flex-wrap items-center gap-3 py-3"
                  data-testid={`category-${category.id}`}
                >
                  <span className="font-medium text-warm-900">{category.name}</span>
                  <Badge variant="gray">{category.code}</Badge>
                  <span className="text-sm text-warm-600">
                    SLA {category.slaHours}h
                  </span>
                  <Badge variant={category.isActive ? 'success' : 'gray'}>
                    {category.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button variant="secondary" onClick={() => openEdit(category)}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit category' : 'New category'}
      >
        <div className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Input
            label="Code"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <Input
            label="SLA hours"
            type="number"
            value={form.slaHours}
            onChange={(e) => setForm({ ...form, slaHours: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm text-warm-700">
            <input
              type="checkbox"
              aria-label="Active"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Active
          </label>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
