'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { branchesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Plus, Edit2, Trash2, RefreshCw, MapPin, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { Branch } from '@/types';

const BRANCH_TYPES = [
    { value: 'HEAD_OFFICE', label: 'Head Office' },
    { value: 'BRANCH_OFFICE', label: 'Branch Office' },
    { value: 'WAREHOUSE', label: 'Warehouse' },
    { value: 'REGIONAL_OFFICE', label: 'Regional Office' },
    { value: 'SATELLITE_OFFICE', label: 'Satellite Office' },
    { value: 'STORE', label: 'Store' },
];

const formatBranchType = (type: string) =>
    BRANCH_TYPES.find((t) => t.value === type)?.label ?? type.replace(/_/g, ' ');

const emptyForm = { name: '', type: 'HEAD_OFFICE', address: '', city: '', state: '', zipCode: '', country: '' };

export default function BranchesPage() {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editing, setEditing] = useState<Branch | null>(null);
    const [deleting, setDeleting] = useState<Branch | null>(null);
    const [formData, setFormData] = useState(emptyForm);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => { loadData(); }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await branchesApi.getAll();
            setBranches(res.data);
        } catch {
            toast.error('Failed to load branches');
        } finally {
            setLoading(false);
        }
    };

    const filtered = branches.filter((b) =>
        b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.type.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const openCreate = () => {
        setEditing(null);
        setFormData(emptyForm);
        setModalOpen(true);
    };

    const openEdit = (b: Branch) => {
        setEditing(b);
        setFormData({
            name: b.name,
            type: b.type,
            address: b.address ?? '',
            city: b.city ?? '',
            state: b.state ?? '',
            zipCode: b.zipCode ?? '',
            country: b.country ?? '',
        });
        setModalOpen(true);
    };

    const handleSave = async () => {
        if (!formData.name.trim()) return;
        setSaving(true);
        try {
            const payload = {
                name: formData.name.trim(),
                type: formData.type,
                address: formData.address.trim() || undefined,
                city: formData.city.trim() || undefined,
                state: formData.state.trim() || undefined,
                zipCode: formData.zipCode.trim() || undefined,
                country: formData.country.trim() || undefined,
            };
            if (editing) {
                await branchesApi.update(editing.id, payload);
                toast.success('Branch updated');
            } else {
                await branchesApi.create(payload);
                toast.success('Branch created');
            }
            setModalOpen(false);
            await loadData();
        } catch {
            toast.error('Failed to save branch');
        } finally {
            setSaving(false);
        }
    };

    const handleToggleActive = async (b: Branch) => {
        try {
            await branchesApi.update(b.id, { isActive: !b.isActive });
            toast.success(b.isActive ? 'Branch deactivated' : 'Branch activated');
            await loadData();
        } catch {
            toast.error('Failed to update branch');
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        setSaving(true);
        try {
            await branchesApi.delete(deleting.id);
            toast.success('Branch deleted');
            setDeleteModalOpen(false);
            setDeleting(null);
            await loadData();
        } catch {
            toast.error('Cannot delete branch with employees. Reassign employees first.');
        } finally {
            setSaving(false);
        }
    };

    const activeCount = branches.filter((b) => b.isActive).length;

    return (
        <>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
                            <MapPin className="w-7 h-7 text-primary-600" />
                            Branches
                        </h1>
                        <p className="text-warm-600 mt-1">Manage office locations and branches</p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreate}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Branch
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-warm-900">{branches.length}</p>
                        <p className="text-sm text-warm-500">Total</p>
                    </CardContent></Card>
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
                        <p className="text-sm text-warm-500">Active</p>
                    </CardContent></Card>
                    <Card><CardContent className="py-4 text-center">
                        <p className="text-2xl font-bold text-warm-400">{branches.length - activeCount}</p>
                        <p className="text-sm text-warm-500">Inactive</p>
                    </CardContent></Card>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-warm-400" />
                    <input type="text" placeholder="Search branches..." value={searchQuery}
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
                            <MapPin className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-warm-900 mb-2">No Branches Found</h3>
                            <p className="text-warm-600 mb-4">
                                {searchQuery ? 'No branches match your search.' : 'No branches configured yet.'}
                            </p>
                            <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Add Branch</Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-warm-200 bg-warm-50">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Name</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Type</th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">Location</th>
                                        <th className="text-center px-4 py-3 text-xs font-medium text-warm-500 uppercase">Employees</th>
                                        <th className="text-center px-4 py-3 text-xs font-medium text-warm-500 uppercase">Status</th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-warm-200">
                                    {filtered.map((b) => (
                                        <tr key={b.id} className={cn('hover:bg-warm-50 transition-colors', !b.isActive && 'opacity-60')}>
                                            <td className="px-4 py-3 text-sm font-medium text-warm-900">{b.name}</td>
                                            <td className="px-4 py-3 text-sm text-warm-600">
                                                <span className="px-2 py-1 bg-warm-100 text-warm-700 rounded text-xs font-medium">
                                                    {formatBranchType(b.type)}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-warm-600">
                                                {[b.city, b.state, b.country].filter(Boolean).join(', ') || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-warm-900 text-center">{b._count?.employees ?? 0}</td>
                                            <td className="px-4 py-3 text-center">
                                                <button onClick={() => handleToggleActive(b)}>
                                                    <Badge variant={b.isActive ? 'success' : 'gray'}>
                                                        {b.isActive ? 'Active' : 'Inactive'}
                                                    </Badge>
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <button onClick={() => openEdit(b)} className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors">
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button onClick={() => { setDeleting(b); setDeleteModalOpen(true); }} className="p-2 text-warm-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
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

            <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Branch' : 'Add Branch'} size="lg">
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">Name *</label>
                            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="e.g., Mumbai Office" className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">Type *</label>
                            <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500">
                                {BRANCH_TYPES.map((t) => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">Street Address</label>
                        <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                            placeholder="e.g., 123 Main Street" className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">City</label>
                            <input type="text" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                                placeholder="e.g., Mumbai" className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">State / Province</label>
                            <input type="text" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                                placeholder="e.g., Maharashtra" className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">ZIP / Postal Code</label>
                            <input type="text" value={formData.zipCode} onChange={(e) => setFormData({ ...formData, zipCode: e.target.value })}
                                placeholder="e.g., 400001" className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-warm-700 mb-1">Country</label>
                            <input type="text" value={formData.country} onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                                placeholder="e.g., India" className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500" />
                        </div>
                    </div>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
                    <Button onClick={handleSave} loading={saving} disabled={!formData.name.trim()}>
                        {editing ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            <Modal isOpen={deleteModalOpen} onClose={() => setDeleteModalOpen(false)} title="Delete Branch" size="sm">
                <p className="text-warm-600">
                    Are you sure you want to delete <strong>{deleting?.name}</strong>? Branches assigned to employees cannot be deleted.
                </p>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setDeleteModalOpen(false)} disabled={saving}>Cancel</Button>
                    <Button variant="danger" onClick={handleDelete} loading={saving}>Delete</Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
