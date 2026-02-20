'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { designationsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Plus, Edit2, Trash2, RefreshCw, Briefcase, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { Designation } from '@/types';

export default function DesignationsPage() {
    const [designations, setDesignations] = useState<Designation[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editing, setEditing] = useState<Designation | null>(null);
    const [deleting, setDeleting] = useState<Designation | null>(null);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await designationsApi.getAll();
            setDesignations(res.data);
        } catch {
            toast.error('Failed to load designations');
        } finally {
            setLoading(false);
        }
    };

    const filtered = designations.filter((d) =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openCreate = () => {
        setEditing(null);
        setName('');
        setModalOpen(true);
    };

    const openEdit = (d: Designation) => {
        setEditing(d);
        setName(d.name);
        setModalOpen(true);
    };

    const handleSave = async () => {
        if (!name.trim()) return;
        setSaving(true);
        try {
            if (editing) {
                await designationsApi.update(editing.id, { name: name.trim() });
                toast.success('Designation updated');
            } else {
                await designationsApi.create({ name: name.trim() });
                toast.success('Designation created');
            }
            setModalOpen(false);
            await loadData();
        } catch {
            toast.error('Failed to save designation');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (d: Designation) => {
        try {
            await designationsApi.update(d.id, { isActive: !d.isActive });
            toast.success(d.isActive ? 'Designation deactivated' : 'Designation activated');
            await loadData();
        } catch {
            toast.error('Failed to update designation');
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        setSaving(true);
        try {
            await designationsApi.delete(deleting.id);
            toast.success('Designation deleted');
            setDeleteModalOpen(false);
            setDeleting(null);
            await loadData();
        } catch {
            toast.error('Cannot delete designation with employees. Reassign employees first.');
        } finally {
            setSaving(false);
        }
    };

    const activeCount = designations.filter((d) => d.isActive).length;

    return (
        <>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
                            <Briefcase className="w-7 h-7 text-primary-600" />
                            Designations
                        </h1>
                        <p className="text-warm-600 mt-1">Manage employee job designations</p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreate}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Designation
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-warm-900">{designations.length}</p>
                        <p className="text-sm text-warm-500">Total</p>
                    </CardContent></Card>
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
                        <p className="text-sm text-warm-500">Active</p>
                    </CardContent></Card>
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-warm-400">{designations.length - activeCount}</p>
                        <p className="text-sm text-warm-500">Inactive</p>
                    </CardContent></Card>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
                    <input type="text" placeholder="Search designations..." value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filtered.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Briefcase className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-warm-900 mb-2">No Designations Found</h3>
                            <p className="text-warm-600 mb-4">
                                {searchQuery ? 'No designations match your search.' : 'No designations configured yet.'}
                            </p>
                            <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Designation</Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-warm-200 bg-warm-50">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Name</th>
                                        <th className="text-center px-4 py-3 text-xs font-medium text-warm-500 uppercase">Employees</th>
                                        <th className="text-center px-4 py-3 text-xs font-medium text-warm-500 uppercase">Status</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-warm-200">
                                    {filtered.map((d) => (
                                        <tr key={d.id} className={cn('hover:bg-warm-50 transition-colors', !d.isActive && 'opacity-60')}>
                                            <td className="px-4 py-3 text-sm font-medium text-warm-900">{d.name}</td>
                                            <td className="px-4 py-3 text-sm text-warm-900 text-center">{d._count?.employees ?? 0}</td>
                                            <td className="px-4 py-3 text-center">
                                                <button onClick={() => handleToggleActive(d)}>
                                                    <Badge variant={d.isActive ? 'success' : 'gray'}>
                                                        {d.isActive ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <button onClick={() => openEdit(d)} className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => { setDeleting(d); setDeleteModalOpen(true); }} className="p-2 text-warm-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}
            </div>

            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Designation' : 'Add Designation'} size="sm">
                <div>
                    <label className="block text-sm font-medium text-warm-700 mb-1">Name *</label>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                        placeholder="e.g., Senior Engineer" onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                        className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={handleSave} loading={saving} disabled={!name.trim()}>
                        {editing ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            <Modal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Designation" size="sm">
                <p className="text-warm-600">
                    Are you sure you want to delete <strong>{deleting?.name}</strong>? Designations assigned to employees cannot be deleted.
                </p>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setDeleteModalOpen(false)} disabled={saving}>Cancel</Button>
                    <Button variant="danger" onClick={handleDelete} loading={saving}>Delete</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
