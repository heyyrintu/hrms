'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { payrollApi } from '@/lib/api';
import { SalaryStructure, SalaryComponent } from '@/types';
import toast from 'react-hot-toast';
import {
    Calculator,
    Plus,
    Edit2,
    Trash2,
    ArrowLeft,
    X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

const emptyComponent: SalaryComponent = {
    name: '',
    type: 'earning',
    calcType: 'percentage',
    value: 0,
};

export default function SalaryStructuresPage() {
    const router = useRouter();
    const [structures, setStructures] = useState<SalaryStructure[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    // Form state
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [components, setComponents] = useState<SalaryComponent[]>([]);

    useEffect(() => {
        loadStructures();
    }, []);

    const loadStructures = async () => {
        setLoading(true);
        try {
            const res = await payrollApi.getStructures();
            setStructures(res.data);
        } catch {
            toast.error('Failed to load salary structures');
        } finally {
            setLoading(false);
        }
    };

    const openCreate = () => {
        setEditingId(null);
        setName('');
        setDescription('');
        setComponents([{ ...emptyComponent }]);
        setShowModal(true);
    };

    const openEdit = (s: SalaryStructure) => {
        setEditingId(s.id);
        setName(s.name);
        setDescription(s.description || '');
        setComponents(s.components.length > 0 ? [...s.components] : [{ ...emptyComponent }]);
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error('Name is required');
            return;
        }
        const validComponents = components.filter((c) => c.name.trim());
        if (validComponents.length === 0) {
            toast.error('Add at least one component');
            return;
        }

        setSaving(true);
        try {
            const data = {
                name: name.trim(),
                description: description.trim() || undefined,
                components: validComponents,
            };
            if (editingId) {
                await payrollApi.updateStructure(editingId, data);
                toast.success('Structure updated');
            } else {
                await payrollApi.createStructure(data);
                toast.success('Structure created');
            }
            setShowModal(false);
            loadStructures();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this salary structure?')) return;
        try {
            await payrollApi.deleteStructure(id);
            toast.success('Structure deleted');
            loadStructures();
        } catch (error: any) {
            toast.error(error.response?.data?.message || 'Failed to delete');
        }
    };

    const updateComponent = (idx: number, field: keyof SalaryComponent, value: any) => {
        setComponents((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
    };

    const removeComponent = (idx: number) => {
        setComponents((prev) => prev.filter((_, i) => i !== idx));
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <button
                            onClick={() => router.push('/payroll')}
                            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-2"
                        >
                            <ArrowLeft className="w-4 h-4" /> Back to Payroll
                        </button>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Calculator className="w-7 h-7 text-primary-600" />
                            Salary Structures
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Define salary components and assign to employees
                        </p>
                    </div>
                    <Button onClick={openCreate}>
                        <Plus className="w-4 h-4 mr-2" />
                        New Structure
                    </Button>
                </div>

                {/* List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : structures.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Calculator className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                No Salary Structures
                            </h3>
                            <p className="text-gray-600">
                                Create a salary structure to define earnings and deductions.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {structures.map((s) => {
                            const earnings = (s.components || []).filter((c) => c.type === 'earning');
                            const deductions = (s.components || []).filter((c) => c.type === 'deduction');
                            return (
                                <Card key={s.id}>
                                    <CardContent className="py-5">
                                        <div className="flex items-start justify-between mb-3">
                                            <div>
                                                <h3 className="font-semibold text-gray-900">{s.name}</h3>
                                                {s.description && (
                                                    <p className="text-sm text-gray-500 mt-0.5">{s.description}</p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Badge variant={s.isActive ? 'success' : 'gray'}>
                                                    {s.isActive ? 'Active' : 'Inactive'}
                                                </Badge>
                                                <span className="text-xs text-gray-400">
                                                    {s._count?.employeeSalaries || 0} employees
                                                </span>
                                            </div>
                                        </div>

                                        {/* Components */}
                                        <div className="space-y-2 mb-4">
                                            {earnings.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-semibold text-green-700 uppercase mb-1">Earnings</p>
                                                    {earnings.map((c, i) => (
                                                        <div key={i} className="flex justify-between text-sm py-0.5">
                                                            <span className="text-gray-600">{c.name}</span>
                                                            <span className="text-green-700 font-medium">
                                                                {c.calcType === 'percentage' ? `${c.value}%` : `₹${c.value}`}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {deductions.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-semibold text-red-700 uppercase mb-1">Deductions</p>
                                                    {deductions.map((c, i) => (
                                                        <div key={i} className="flex justify-between text-sm py-0.5">
                                                            <span className="text-gray-600">{c.name}</span>
                                                            <span className="text-red-700 font-medium">
                                                                {c.calcType === 'percentage' ? `${c.value}%` : `₹${c.value}`}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex gap-2 pt-2 border-t border-gray-100">
                                            <Button variant="secondary" size="sm" onClick={() => openEdit(s)}>
                                                <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => handleDelete(s.id)}
                                                className="text-red-600 hover:bg-red-50"
                                            >
                                                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Create/Edit Modal */}
            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={`${editingId ? 'Edit' : 'Create'} Salary Structure`} size="lg">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                            placeholder="e.g., Standard CTC Package"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Description (optional)
                        </label>
                        <input
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
                        />
                    </div>
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-sm font-medium text-gray-700">Components</label>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setComponents((prev) => [...prev, { ...emptyComponent }])}
                            >
                                <Plus className="w-3.5 h-3.5 mr-1" /> Add
                            </Button>
                        </div>
                        <div className="space-y-3 max-h-64 overflow-y-auto">
                            {components.map((comp, idx) => (
                                <div key={idx} className="flex gap-2 items-start p-3 bg-gray-50 rounded-lg">
                                    <div className="flex-1 grid grid-cols-2 gap-2">
                                        <input
                                            type="text"
                                            placeholder="Component Name"
                                            value={comp.name}
                                            onChange={(e) => updateComponent(idx, 'name', e.target.value)}
                                            className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-sm"
                                        />
                                        <select
                                            value={comp.type}
                                            onChange={(e) => updateComponent(idx, 'type', e.target.value)}
                                            className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                                        >
                                            <option value="earning">Earning</option>
                                            <option value="deduction">Deduction</option>
                                        </select>
                                        <select
                                            value={comp.calcType}
                                            onChange={(e) => updateComponent(idx, 'calcType', e.target.value)}
                                            className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                                        >
                                            <option value="percentage">% of Base</option>
                                            <option value="fixed">Fixed Amount</option>
                                        </select>
                                        <input
                                            type="number"
                                            placeholder="Value"
                                            value={comp.value || ''}
                                            onChange={(e) => updateComponent(idx, 'value', parseFloat(e.target.value) || 0)}
                                            className="col-span-2 px-2 py-1.5 border border-gray-300 rounded text-sm"
                                            min={0}
                                        />
                                    </div>
                                    <button
                                        onClick={() => removeComponent(idx)}
                                        className="p-1 text-gray-400 hover:text-red-500"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={() => setShowModal(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} loading={saving}>
                        {editingId ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
