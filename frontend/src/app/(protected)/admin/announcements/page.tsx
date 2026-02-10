'use client';

import { useEffect, useState } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { announcementsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    Megaphone,
    Search,
    Eye,
    EyeOff,
} from 'lucide-react';
import { AnnouncementPriority } from '@/types';

interface Announcement {
    id: string;
    title: string;
    content: string;
    priority: AnnouncementPriority;
    isPublished: boolean;
    publishedAt?: string;
    expiresAt?: string;
    author?: { firstName: string; lastName: string };
    createdAt: string;
    updatedAt: string;
}

const priorityOptions: { value: AnnouncementPriority; label: string }[] = [
    { value: AnnouncementPriority.LOW, label: 'Low' },
    { value: AnnouncementPriority.NORMAL, label: 'Normal' },
    { value: AnnouncementPriority.HIGH, label: 'High' },
    { value: AnnouncementPriority.URGENT, label: 'Urgent' },
];

const priorityColors: Record<AnnouncementPriority, string> = {
    [AnnouncementPriority.LOW]: 'gray',
    [AnnouncementPriority.NORMAL]: 'info',
    [AnnouncementPriority.HIGH]: 'warning',
    [AnnouncementPriority.URGENT]: 'danger',
};

const emptyFormData = {
    title: '',
    content: '',
    priority: AnnouncementPriority.NORMAL as AnnouncementPriority,
    isPublished: false,
    expiresAt: '',
};

export default function AnnouncementsAdminPage() {
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
    const [deletingAnnouncement, setDeletingAnnouncement] = useState<Announcement | null>(null);
    const [formData, setFormData] = useState(emptyFormData);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    useEffect(() => {
        loadData();
    }, [page]);

    const loadData = async () => {
        setLoading(true);
        try {
            const res = await announcementsApi.getAll({ page, limit: 20 });
            setAnnouncements(res.data.data || []);
            setTotalPages(res.data.meta?.totalPages || 1);
        } catch (error) {
            console.error('Failed to load announcements:', error);
        } finally {
            setLoading(false);
        }
    };

    const filteredAnnouncements = announcements.filter((a) =>
        a.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const openCreateModal = () => {
        setEditingAnnouncement(null);
        setFormData(emptyFormData);
        setModalOpen(true);
    };

    const openEditModal = (announcement: Announcement) => {
        setEditingAnnouncement(announcement);
        setFormData({
            title: announcement.title,
            content: announcement.content,
            priority: announcement.priority,
            isPublished: announcement.isPublished,
            expiresAt: announcement.expiresAt
                ? announcement.expiresAt.split('T')[0]
                : '',
        });
        setModalOpen(true);
    };

    const openDeleteModal = (announcement: Announcement) => {
        setDeletingAnnouncement(announcement);
        setDeleteModalOpen(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                title: formData.title,
                content: formData.content,
                priority: formData.priority,
                isPublished: formData.isPublished,
                expiresAt: formData.expiresAt || undefined,
            };

            if (editingAnnouncement) {
                await announcementsApi.update(editingAnnouncement.id, payload);
            } else {
                await announcementsApi.create(payload);
            }
            setModalOpen(false);
            await loadData();
        } catch (error) {
            console.error('Failed to save announcement:', error);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingAnnouncement) return;
        setSaving(true);
        try {
            await announcementsApi.delete(deletingAnnouncement.id);
            setDeleteModalOpen(false);
            setDeletingAnnouncement(null);
            await loadData();
        } catch (error) {
            console.error('Failed to delete announcement:', error);
        } finally {
            setSaving(false);
        }
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const isExpired = (announcement: Announcement) => {
        if (!announcement.expiresAt) return false;
        return new Date(announcement.expiresAt) < new Date();
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Megaphone className="w-7 h-7 text-primary-600" />
                            Announcements
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Create and manage company announcements
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreateModal}>
                            <Plus className="w-4 h-4 mr-2" />
                            New Announcement
                        </Button>
                    </div>
                </div>

                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search announcements..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    />
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-gray-900">
                                {announcements.length}
                            </p>
                            <p className="text-sm text-gray-500">Total</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-green-600">
                                {announcements.filter((a) => a.isPublished && !isExpired(a)).length}
                            </p>
                            <p className="text-sm text-gray-500">Active</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-gray-500">
                                {announcements.filter((a) => !a.isPublished).length}
                            </p>
                            <p className="text-sm text-gray-500">Drafts</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="py-4 text-center">
                            <p className="text-2xl font-bold text-red-600">
                                {announcements.filter((a) => a.priority === AnnouncementPriority.URGENT).length}
                            </p>
                            <p className="text-sm text-gray-500">Urgent</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Announcements List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : filteredAnnouncements.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Megaphone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                No Announcements Found
                            </h3>
                            <p className="text-gray-600 mb-4">
                                {searchQuery
                                    ? 'No announcements match your search.'
                                    : 'Create your first announcement to get started.'}
                            </p>
                            <Button onClick={openCreateModal}>
                                <Plus className="w-4 h-4 mr-2" />
                                New Announcement
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-4">
                        {filteredAnnouncements.map((announcement) => (
                            <Card key={announcement.id}>
                                <CardContent className="py-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-base font-semibold text-gray-900">
                                                    {announcement.title}
                                                </h3>
                                                <Badge
                                                    variant={
                                                        priorityColors[announcement.priority] as
                                                            | 'gray'
                                                            | 'info'
                                                            | 'warning'
                                                            | 'danger'
                                                    }
                                                >
                                                    {announcement.priority}
                                                </Badge>
                                                {announcement.isPublished ? (
                                                    isExpired(announcement) ? (
                                                        <Badge variant="gray">Expired</Badge>
                                                    ) : (
                                                        <Badge variant="success">Published</Badge>
                                                    )
                                                ) : (
                                                    <Badge variant="gray">Draft</Badge>
                                                )}
                                            </div>
                                            <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                                                {announcement.content}
                                            </p>
                                            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                                                {announcement.author && (
                                                    <span>
                                                        By {announcement.author.firstName}{' '}
                                                        {announcement.author.lastName}
                                                    </span>
                                                )}
                                                <span>Created {formatDate(announcement.createdAt)}</span>
                                                {announcement.publishedAt && (
                                                    <span>
                                                        Published {formatDate(announcement.publishedAt)}
                                                    </span>
                                                )}
                                                {announcement.expiresAt && (
                                                    <span>
                                                        Expires {formatDate(announcement.expiresAt)}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                            <button
                                                onClick={() => openEditModal(announcement)}
                                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                                                title="Edit"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => openDeleteModal(announcement)}
                                                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between">
                                <p className="text-sm text-gray-500">
                                    Page {page} of {totalPages}
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        disabled={page <= 1}
                                    >
                                        Previous
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                        disabled={page >= totalPages}
                                    >
                                        Next
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Create/Edit Modal */}
            <Modal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}
                size="lg"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Title *
                        </label>
                        <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                            placeholder="Announcement title"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Content *
                        </label>
                        <textarea
                            value={formData.content}
                            onChange={(e) =>
                                setFormData({ ...formData, content: e.target.value })
                            }
                            placeholder="Announcement content..."
                            rows={5}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Priority
                            </label>
                            <select
                                value={formData.priority}
                                onChange={(e) =>
                                    setFormData({
                                        ...formData,
                                        priority: e.target.value as AnnouncementPriority,
                                    })
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            >
                                {priorityOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Expires At
                            </label>
                            <input
                                type="date"
                                value={formData.expiresAt}
                                onChange={(e) =>
                                    setFormData({ ...formData, expiresAt: e.target.value })
                                }
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                            />
                        </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={formData.isPublished}
                            onChange={(e) =>
                                setFormData({ ...formData, isPublished: e.target.checked })
                            }
                            className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                        />
                        <span className="text-sm text-gray-700">
                            {formData.isPublished ? (
                                <span className="flex items-center gap-1">
                                    <Eye className="w-4 h-4 text-green-600" />
                                    Published — visible to all employees
                                </span>
                            ) : (
                                <span className="flex items-center gap-1">
                                    <EyeOff className="w-4 h-4 text-gray-400" />
                                    Draft — not visible to employees
                                </span>
                            )}
                        </span>
                    </label>
                </div>

                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => setModalOpen(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        loading={saving}
                        disabled={!formData.title || !formData.content}
                    >
                        {editingAnnouncement ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete Confirmation */}
            <Modal
                isOpen={deleteModalOpen}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete Announcement"
                size="sm"
            >
                <p className="text-gray-600">
                    Are you sure you want to delete{' '}
                    <strong>{deletingAnnouncement?.title}</strong>? This action cannot
                    be undone.
                </p>
                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => setDeleteModalOpen(false)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDelete} loading={saving}>
                        Delete
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
