'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { feedbackApi, employeesApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import {
  MessageSquare,
  Plus,
  RefreshCw,
  Inbox,
  Send,
  Users,
  Trash2,
  Lock,
} from 'lucide-react';
import toast from 'react-hot-toast';

type FeedbackType = 'POSITIVE' | 'CONSTRUCTIVE' | 'GENERAL';
type FeedbackVisibility = 'PRIVATE' | 'VISIBLE_TO_MANAGER' | 'PUBLIC';

interface FeedbackParticipant {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string;
}

interface FeedbackItem {
  id: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: FeedbackType;
  visibility: FeedbackVisibility;
  createdAt: string;
  sender?: FeedbackParticipant;
  receiver?: FeedbackParticipant;
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string;
}

type TabKey = 'received' | 'sent' | 'team';

const typeLabels: Record<FeedbackType, string> = {
  POSITIVE: 'Appreciation',
  CONSTRUCTIVE: 'Constructive',
  GENERAL: 'General',
};

const typeColors: Record<FeedbackType, 'success' | 'warning' | 'gray'> = {
  POSITIVE: 'success',
  CONSTRUCTIVE: 'warning',
  GENERAL: 'gray',
};

const visibilityLabels: Record<FeedbackVisibility, string> = {
  PRIVATE: 'Private',
  VISIBLE_TO_MANAGER: 'Visible to manager',
  PUBLIC: 'Public',
};

const emptyFormData = {
  receiverId: '',
  type: 'POSITIVE' as FeedbackType,
  visibility: 'PRIVATE' as FeedbackVisibility,
  content: '',
};

const personName = (p?: FeedbackParticipant) =>
  p ? `${p.firstName} ${p.lastName}` : 'Unknown';

export default function FeedbackPage() {
  const { user, isManager } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('received');
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState(emptyFormData);
  const [saving, setSaving] = useState(false);

  const [deletingItem, setDeletingItem] = useState<FeedbackItem | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // The team tab exposes feedback about other people, so it is only offered to
  // the roles the API will actually serve it to.
  const canSeeTeam = !!isManager;

  const tabs: { key: TabKey; label: string; icon: typeof Inbox }[] = [
    { key: 'received', label: 'Received', icon: Inbox },
    { key: 'sent', label: 'Sent', icon: Send },
    ...(canSeeTeam
      ? [{ key: 'team' as TabKey, label: 'Team', icon: Users }]
      : []),
  ];

  const loadFeedback = useCallback(async () => {
    setLoading(true);
    try {
      const res =
        activeTab === 'received'
          ? await feedbackApi.getReceived()
          : activeTab === 'sent'
            ? await feedbackApi.getSent()
            : await feedbackApi.getTeam();
      setItems(res.data?.data ?? []);
    } catch {
      toast.error('Failed to load feedback');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  const openCreateModal = async () => {
    setFormData(emptyFormData);
    setModalOpen(true);
    if (employees.length > 0) return;
    try {
      const res = await employeesApi.getAll({ status: 'ACTIVE', limit: 500 });
      const list: EmployeeOption[] = res.data?.data ?? res.data ?? [];
      setEmployees(list.filter((e) => e.id !== user?.employeeId));
    } catch {
      toast.error('Failed to load employees');
    }
  };

  const handleSave = async () => {
    if (!formData.receiverId) {
      toast.error('Choose who the feedback is for');
      return;
    }
    if (!formData.content.trim()) {
      toast.error('Write the feedback before sharing it');
      return;
    }

    setSaving(true);
    try {
      await feedbackApi.give({
        receiverId: formData.receiverId,
        content: formData.content.trim(),
        type: formData.type,
        visibility: formData.visibility,
      });
      toast.success('Feedback shared');
      setModalOpen(false);
      setFormData(emptyFormData);
      await loadFeedback();
    } catch (err: unknown) {
      const axiosError = err as { response?: { data?: { message?: string } } };
      toast.error(
        axiosError.response?.data?.message || 'Failed to share feedback',
      );
    } finally {
      setSaving(false);
    }
  };

  const openDeleteModal = (item: FeedbackItem) => {
    setDeletingItem(item);
    setDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingItem) return;
    setSaving(true);
    try {
      await feedbackApi.delete(deletingItem.id);
      toast.success('Feedback deleted');
      setDeleteModalOpen(false);
      setDeletingItem(null);
      await loadFeedback();
    } catch {
      toast.error('Failed to delete feedback');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

  const emptyMessage =
    activeTab === 'received'
      ? 'No one has shared feedback with you yet.'
      : activeTab === 'sent'
        ? 'You have not shared any feedback yet.'
        : 'No feedback on your team is visible to you.';

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-warm-900 flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-primary-600" />
              Continuous Feedback
            </h1>
            <p className="text-warm-600 mt-1">
              Share and review feedback with your colleagues
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={loadFeedback}
              disabled={loading}
            >
              <RefreshCw
                className={cn('w-4 h-4 mr-2', loading && 'animate-spin')}
              />
              Refresh
            </Button>
            <Button onClick={openCreateModal}>
              <Plus className="w-4 h-4 mr-2" />
              Give Feedback
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-warm-200">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  activeTab === tab.key
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-warm-500 hover:text-warm-700',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <MessageSquare className="w-16 h-16 text-warm-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-warm-900 mb-2">
                No Feedback
              </h3>
              <p className="text-warm-600 mb-4">{emptyMessage}</p>
              <Button onClick={openCreateModal}>
                <Plus className="w-4 h-4 mr-2" />
                Give Feedback
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.id}>
                <CardContent className="py-4">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-warm-900">
                          {activeTab === 'sent'
                            ? `To ${personName(item.receiver)}`
                            : `From ${personName(item.sender)}`}
                        </span>
                        {activeTab === 'team' && (
                          <span className="text-sm text-warm-500">
                            about {personName(item.receiver)}
                          </span>
                        )}
                        <Badge variant={typeColors[item.type]}>
                          {typeLabels[item.type]}
                        </Badge>
                        {item.visibility === 'PRIVATE' && (
                          <span
                            className="inline-flex items-center gap-1 text-xs text-warm-500"
                            title="Only you and the other person can read this"
                          >
                            <Lock className="w-3 h-3" />
                            {visibilityLabels.PRIVATE}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-warm-700 whitespace-pre-line">
                        {item.content}
                      </p>
                      <p className="mt-2 text-xs text-warm-400">
                        {formatDate(item.createdAt)} ·{' '}
                        {visibilityLabels[item.visibility]}
                      </p>
                    </div>
                    {item.senderId === user?.employeeId && (
                      <button
                        onClick={() => openDeleteModal(item)}
                        className="p-2 self-start text-warm-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete feedback"
                        aria-label="Delete feedback"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Give feedback */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Give Feedback"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Colleague *
            </label>
            <select
              value={formData.receiverId}
              onChange={(e) =>
                setFormData({ ...formData, receiverId: e.target.value })
              }
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">Select employee</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.firstName} {emp.lastName}
                  {emp.employeeCode ? ` (${emp.employeeCode})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Type *
              </label>
              <select
                value={formData.type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    type: e.target.value as FeedbackType,
                  })
                }
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="POSITIVE">Appreciation</option>
                <option value="CONSTRUCTIVE">Constructive</option>
                <option value="GENERAL">General</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-warm-700 mb-1">
                Visibility *
              </label>
              <select
                value={formData.visibility}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    visibility: e.target.value as FeedbackVisibility,
                  })
                }
                className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="PRIVATE">Private</option>
                <option value="VISIBLE_TO_MANAGER">Visible to manager</option>
                <option value="PUBLIC">Public</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-warm-700 mb-1">
              Feedback *
            </label>
            <textarea
              value={formData.content}
              onChange={(e) =>
                setFormData({ ...formData, content: e.target.value })
              }
              placeholder="What went well, or what could go better..."
              rows={5}
              className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
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
            disabled={!formData.receiverId || !formData.content.trim()}
          >
            Share
          </Button>
        </ModalFooter>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete Feedback"
        size="sm"
      >
        <p className="text-warm-600">
          Are you sure you want to delete this feedback for{' '}
          <strong>{personName(deletingItem?.receiver)}</strong>?
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
