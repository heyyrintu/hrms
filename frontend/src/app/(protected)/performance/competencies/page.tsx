'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Power, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useAuth } from '@/contexts/AuthContext';
import { designationsApi } from '@/lib/api';
import { competenciesApi } from '@/lib/api-performance-competencies';
import type { Competency, CompetencyInput } from '@/lib/api-performance-competencies';

type Tab = 'library' | 'mapping';

interface MappingRow { competencyId: string; name: string; expectedLevel: number }

function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

const LEVELS = [1, 2, 3, 4, 5];

export default function CompetenciesPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('library');

  const [competencies, setCompetencies] = useState<Competency[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Competency | null>(null);
  const [form, setForm] = useState({ name: '', description: '', category: '' });
  const [saving, setSaving] = useState(false);

  const [designations, setDesignations] = useState<Array<{ id: string; name: string }>>([]);
  const [designationId, setDesignationId] = useState('');
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [addId, setAddId] = useState('');
  const [mappingLoading, setMappingLoading] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await competenciesApi.list();
      setCompetencies(res.data);
    } catch (err) {
      setError(true);
      toast.error(errorMessage(err, 'Failed to load competencies'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
    (async () => {
      try {
        const res = await designationsApi.getAll();
        setDesignations(Array.isArray(res.data) ? res.data : (res.data?.data ?? []));
      } catch {
        toast.error('Failed to load designations');
      }
    })();
  }, [isAdmin, load]);

  useEffect(() => {
    if (!isAdmin || !designationId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setMappingLoading(true);
      try {
        const res = await competenciesApi.forDesignation(designationId);
        if (!cancelled) {
          setRows(res.data.map((d) => ({ competencyId: d.competencyId, name: d.competency.name, expectedLevel: d.expectedLevel })));
        }
      } catch (err) {
        if (!cancelled) toast.error(errorMessage(err, 'Failed to load the designation mapping'));
      } finally {
        if (!cancelled) setMappingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, designationId]);

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-warm-600">You do not have access</CardContent>
      </Card>
    );
  }

  const openModal = (c?: Competency) => {
    setEditing(c ?? null);
    setForm({ name: c?.name ?? '', description: c?.description ?? '', category: c?.category ?? '' });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const payload: CompetencyInput = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      category: form.category.trim() || undefined,
    };
    setSaving(true);
    try {
      if (editing) {
        await competenciesApi.update(editing.id, payload);
        toast.success('Competency updated');
      } else {
        await competenciesApi.create(payload);
        toast.success('Competency added');
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save competency'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c: Competency) => {
    try {
      await competenciesApi.update(c.id, { isActive: !c.isActive });
      toast.success(c.isActive ? 'Competency deactivated' : 'Competency activated');
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to update competency'));
    }
  };

  const handleDelete = async (c: Competency) => {
    if (!window.confirm(`Delete competency "${c.name}"?`)) return;
    try {
      await competenciesApi.remove(c.id);
      toast.success('Competency deleted');
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to delete competency'));
    }
  };

  const addRow = () => {
    const c = competencies.find((x) => x.id === addId);
    if (!c) return;
    setRows((r) => [...r, { competencyId: c.id, name: c.name, expectedLevel: 3 }]);
    setAddId('');
  };

  const saveMapping = async () => {
    if (!designationId) return;
    setSavingMapping(true);
    try {
      await competenciesApi.setForDesignation(
        designationId,
        rows.map((r) => ({ competencyId: r.competencyId, expectedLevel: r.expectedLevel })),
      );
      toast.success('Mapping saved');
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save mapping'));
    } finally {
      setSavingMapping(false);
    }
  };

  const available = competencies.filter((c) => c.isActive && !rows.some((r) => r.competencyId === c.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-warm-900">Competencies</h1>
          <p className="text-sm text-warm-500">Maintain the competency library and set the expected level for each designation.</p>
        </div>
        {tab === 'library' && (
          <Button onClick={() => openModal()}>
            <Plus className="h-4 w-4 mr-1" /> Add competency
          </Button>
        )}
      </div>

      <div role="tablist" className="flex gap-1 border-b border-warm-200">
        {([['library', 'Library'], ['mapping', 'Designation mapping']] as Array<[Tab, string]>).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${
              tab === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-warm-500 hover:text-warm-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'library' ? (
        loading ? (
          <p className="text-sm text-warm-500">Loading competencies...</p>
        ) : error ? (
          <Card><CardContent className="p-6 text-center text-sm text-red-600">Could not load competencies.</CardContent></Card>
        ) : competencies.length === 0 ? (
          <Card><CardContent className="p-8 text-center text-warm-500">No competencies yet. Add the first one.</CardContent></Card>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Designations</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {competencies.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-warm-900">{c.name}</TableCell>
                  <TableCell>{c.category ?? '-'}</TableCell>
                  <TableCell className="max-w-xs text-sm text-warm-600">{c.description ?? '-'}</TableCell>
                  <TableCell>{c.mappedDesignations}</TableCell>
                  <TableCell><Badge variant={c.isActive ? 'success' : 'gray'}>{c.isActive ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <button type="button" aria-label={`Edit ${c.name}`} onClick={() => openModal(c)} className="p-1.5 rounded hover:bg-warm-100 text-warm-500">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`${c.isActive ? 'Deactivate' : 'Activate'} ${c.name}`}
                        onClick={() => toggleActive(c)}
                        className="p-1.5 rounded hover:bg-warm-100 text-warm-500"
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label={`Delete ${c.name}`} onClick={() => handleDelete(c)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : (
        <div className="space-y-4">
          <div className="max-w-sm">
            <Select
              label="Designation"
              value={designationId}
              onChange={(e) => setDesignationId(e.target.value)}
              placeholder="Select a designation"
              options={designations.map((d) => ({ value: d.id, label: d.name }))}
            />
          </div>
          {!designationId ? (
            <p className="text-sm text-warm-500">Choose a designation to edit its expected competency levels.</p>
          ) : mappingLoading ? (
            <p className="text-sm text-warm-500">Loading mapping...</p>
          ) : (
            <Card>
              <CardContent className="p-4 space-y-3">
                {rows.length === 0 && <p className="text-sm text-warm-500">No competencies are mapped to this designation yet.</p>}
                {rows.map((r) => (
                  <div key={r.competencyId} className="flex items-center gap-3">
                    <span className="flex-1 text-sm font-medium text-warm-900">{r.name}</span>
                    <select
                      aria-label={`Expected level for ${r.name}`}
                      className="input w-24"
                      value={r.expectedLevel}
                      onChange={(e) =>
                        setRows((all) => all.map((x) => (x.competencyId === r.competencyId ? { ...x, expectedLevel: Number(e.target.value) } : x)))
                      }
                    >
                      {LEVELS.map((l) => (
                        <option key={l} value={l}>{l}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Remove ${r.name}`}
                      onClick={() => setRows((all) => all.filter((x) => x.competencyId !== r.competencyId))}
                      className="p-1.5 rounded hover:bg-red-50 text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <div className="flex items-end gap-2 pt-2 border-t border-warm-100">
                  <div className="flex-1">
                    <Select
                      label="Add competency"
                      value={addId}
                      onChange={(e) => setAddId(e.target.value)}
                      placeholder="Select a competency"
                      options={available.map((c) => ({ value: c.id, label: c.name }))}
                    />
                  </div>
                  <Button variant="secondary" onClick={addRow} disabled={!addId}>Add</Button>
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveMapping} disabled={savingMapping}>Save mapping</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit competency' : 'Add competency'}>
        <div className="space-y-4">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <div>
            <label htmlFor="competency-description" className="label">Description</label>
            <textarea
              id="competency-description"
              className="input min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
        </div>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.name.trim() || saving}>{editing ? 'Save changes' : 'Add competency'}</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
