'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { departmentsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Plus, Edit2, Trash2, RefreshCw, Building2, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { Department } from '@/types';

const emptyForm = { name: '', code: '', description: '', parentId: '' };

export default function DepartmentsAdminPage() {
    const [departments, setDepartments] = useState<Department[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editing, setEditing] = useState<Department | null>(null);
    const [deleting, setDeleting] = useState<Department | null>(null);
    const [formData, setFormData] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await departmentsApi.getAll();
            setDepartments(res.data);
        } catch {
            toast.error('Failed to load departments');
        } finally {
            setLoading(false);
        }
    };

    const filtered = departments.filter((d) =>
        d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.code.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openCreate = () => {
        setEditing(null);
        setFormData(emptyForm);
        setModalOpen(true);
    };

    const openEdit = (dept: Department) => {
        setEditing(dept);
        setFormData({
            name: dept.name,
            code: dept.code,
            description: dept.description || '',
            parentId: dept.parentId || '',
        });
        setModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.name || !formData.code) return;
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                name: formData.name,
                code: formData.code,
                description: formData.description || undefined,
                parentId: formData.parentId || undefined,
            };
            if (editing) {
                await departmentsApi.update(editing.id, payload);
                toast.success('Department updated');
            } else {
                await departmentsApi.create(payload);
                toast.success('Department created');
            }
            setModalOpen(false);
            await loadData();
        } catch {
            toast.error('Failed to save department');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        setSaving(true);
        try {
            await departmentsApi.delete(deleting.id);
            toast.success('Department deleted');
            setDeleteModalOpen(false);
            setDeleting(null);
            await loadData();
        } catch {
            toast.error('Cannot delete department with employees or sub-departments.');
        } finally {
            setSaving(false);
        }
    };

    const activeCount = departments.filter((d) => d.isActive).length;
    const parentDepts = departments.filter((d) => !d.parentId);

    return (
        <>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
                            <Building2 className="w-7 h-7 text-primary-600" />
                            Departments
                        </h1>
                        <p className="text-warm-600 mt-1">Manage organizational departments</p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreate}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Department
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-warm-900">{departments.length}</p>
                        <p className="text-sm text-warm-500">Total</p>
                    </CardContent></Card>
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
                        <p className="text-sm text-warm-500">Active</p>
                    </CardContent></Card>
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-warm-400">{departments.length - activeCount}</p>
                        <p className="text-sm text-warm-500">Inactive</p>
                    </CardContent></Card>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
                    <input
                        type="text"
                        placeholder="Search departments..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filtered.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Building2 className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-warm-900 mb-2">No Departments Found</h3>
                            <p className="text-warm-600 mb-4">
                                {searchQuery ? 'No departments match your search.' : 'No departments configured yet.'}
                            </p>
                            <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Department</Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-warm-200 bg-warm-50">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Name</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Code</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Parent</th>
                                        <th className="text-center px-4 py-3 text-xs font-medium text-warm-500 uppercase">Employees</th>
                                        <th className="text-center px-4 py-3 text-xs font-medium text-warm-500 uppercase">Status</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-warm-200">
                                    {filtered.map((dept) => (
                                        <tr key={dept.id} className={cn('hover:bg-warm-50 transition-colors', !dept.isActive && 'opacity-60')}>
                                            <td className="px-4 py-3 text-sm font-medium text-warm-900">{dept.name}</td>
                                            <td className="px-4 py-3 text-sm text-warm-500 font-mono">{dept.code}</td>
                                            <td className="px-4 py-3 text-sm text-warm-600">{dept.parent?.name || '—'}</td>
                                            <td className="px-4 py-3 text-sm text-warm-900 text-center">
                                                {(dept as Department & { _count?: { employees: number } })._count?.employees ?? 0}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <Badge variant={dept.isActive ? 'success' : 'gray'}>
                                                    {dept.isActive ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <button onClick={() => openEdit(dept)} className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => { setDeleting(dept); setDeleteModalOpen(true); }} className="p-2 text-warm-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
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

            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Department' : 'Add Department'} size="lg">
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">Name *</label>
                            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g., Engineering" className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">Code *</label>
                            <input type="text" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                                placeholder="e.g., ENG" className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 font-mono" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">Parent Department</label>
                        <select value={formData.parentId} onChange={(e) => setFormData({ ...formData, parentId: e.target.value })}
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                            <option value="">None (Top-level)</option>
                            {parentDepts.filter((d) => d.id !== editing?.id).map((d) => (
                                <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">Description</label>
                        <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Brief description..." rows={2} className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none" />
                    </div>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={handleSave} loading={saving} disabled={!formData.name || !formData.code}>
                        {editing ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            <Modal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Department" size="sm">
                <p className="text-warm-600">
                    Are you sure you want to delete <strong>{deleting?.name}</strong>? Departments with employees or sub-departments cannot be deleted.
                </p>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setDeleteModalOpen(false)} disabled={saving}>Cancel</Button>
                    <Button variant="danger" onClick={handleDelete} loading={saving}>Delete</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
