'use client';

import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Modal, ModalFooter } from '@/components/ui/Modal';
import { webhooksApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
    Plus,
    Edit2,
    Trash2,
    RefreshCw,
    Webhook as WebhookIcon,
    Send,
    ScrollText,
    KeyRound,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — the shapes the API actually returns
// ---------------------------------------------------------------------------

/**
 * Note the absence of `secret`. The API masks it deliberately, so the page can
 * show whether one is set and the last four characters, and nothing more.
 */
interface Webhook {
    id: string;
    url: string;
    events: string[];
    description: string | null;
    isActive: boolean;
    hasSecret: boolean;
    secretHint: string | null;
    createdAt: string;
    updatedAt: string;
}

interface WebhookLog {
    id: string;
    event: string;
    status: 'SUCCESS' | 'FAILED' | 'RETRYING';
    httpStatus: number | null;
    responseBody: string | null;
    errorMessage: string | null;
    attemptCount: number;
    triggeredAt: string;
}

const statusVariants: Record<WebhookLog['status'], 'success' | 'danger' | 'warning'> = {
    SUCCESS: 'success',
    FAILED: 'danger',
    RETRYING: 'warning',
};

const emptyForm = {
    url: '',
    events: [] as string[],
    secret: '',
    description: '',
    isActive: true,
};

export default function WebhooksAdminPage() {
    const [webhooks, setWebhooks] = useState<Webhook[]>([]);
    const [availableEvents, setAvailableEvents] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Webhook | null>(null);
    const [formData, setFormData] = useState(emptyForm);
    const [saving, setSaving] = useState(false);

    const [deleting, setDeleting] = useState<Webhook | null>(null);
    const [testingId, setTestingId] = useState<string | null>(null);

    const [logsFor, setLogsFor] = useState<Webhook | null>(null);
    const [logs, setLogs] = useState<WebhookLog[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logStatusFilter, setLogStatusFilter] = useState('');

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [webhookRes, eventRes] = await Promise.all([
                webhooksApi.list(),
                webhooksApi.getEvents(),
            ]);
            setWebhooks(webhookRes.data ?? []);
            setAvailableEvents(eventRes.data?.events ?? []);
        } catch {
            toast.error('Could not load webhooks.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // -----------------------------------------------------------------------
    // Create / edit
    // -----------------------------------------------------------------------

    const openCreateModal = () => {
        setEditing(null);
        setFormData(emptyForm);
        setModalOpen(true);
    };

    const openEditModal = (webhook: Webhook) => {
        setEditing(webhook);
        setFormData({
            url: webhook.url,
            events: [...webhook.events],
            // The stored secret is never sent to the browser, so this starts
            // blank: leaving it blank keeps whatever is already stored.
            secret: '',
            description: webhook.description ?? '',
            isActive: webhook.isActive,
        });
        setModalOpen(true);
    };

    const toggleEvent = (event: string) => {
        setFormData((prev) => ({
            ...prev,
            events: prev.events.includes(event)
                ? prev.events.filter((e) => e !== event)
                : [...prev.events, event],
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                url: formData.url.trim(),
                events: formData.events,
                description: formData.description || undefined,
                isActive: formData.isActive,
            };
            if (formData.secret) {
                payload.secret = formData.secret;
            }

            if (editing) {
                await webhooksApi.update(editing.id, payload);
                toast.success('Webhook updated.');
            } else {
                await webhooksApi.create(payload);
                toast.success('Webhook created.');
            }
            setModalOpen(false);
            await loadData();
        } catch (error) {
            const message =
                (error as { response?: { data?: { message?: string } } })?.response
                    ?.data?.message ?? 'Could not save the webhook.';
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        setSaving(true);
        try {
            await webhooksApi.delete(deleting.id);
            toast.success('Webhook deleted.');
            setDeleting(null);
            await loadData();
        } catch {
            toast.error('Could not delete the webhook.');
        } finally {
            setSaving(false);
        }
    };

    // -----------------------------------------------------------------------
    // Test delivery
    // -----------------------------------------------------------------------

    const handleTest = async (webhook: Webhook) => {
        setTestingId(webhook.id);
        try {
            const res = await webhooksApi.test(webhook.id);
            const log = res.data as WebhookLog;
            if (log?.status === 'SUCCESS') {
                toast.success(
                    `Endpoint answered ${log.httpStatus ?? 'OK'}. Test delivered.`
                );
            } else {
                toast.error(
                    `Test failed: ${log?.errorMessage ?? `HTTP ${log?.httpStatus ?? '?'}`}`
                );
            }
            // A test writes a log row, so a log view that is open is now stale.
            if (logsFor?.id === webhook.id) {
                await loadLogs(webhook, logStatusFilter);
            }
        } catch {
            toast.error('Could not send the test delivery.');
        } finally {
            setTestingId(null);
        }
    };

    // -----------------------------------------------------------------------
    // Delivery log
    // -----------------------------------------------------------------------

    const loadLogs = async (webhook: Webhook, status: string) => {
        setLogsLoading(true);
        try {
            const params: Record<string, unknown> = { page: 1, limit: 25 };
            if (status) params.status = status;
            const res = await webhooksApi.getLogs(webhook.id, params);
            setLogs(res.data?.data ?? []);
        } catch {
            toast.error('Could not load the delivery log.');
            setLogs([]);
        } finally {
            setLogsLoading(false);
        }
    };

    const openLogs = async (webhook: Webhook) => {
        setLogsFor(webhook);
        setLogStatusFilter('');
        setLogs([]);
        await loadLogs(webhook, '');
    };

    const changeLogFilter = async (status: string) => {
        setLogStatusFilter(status);
        if (logsFor) {
            await loadLogs(logsFor, status);
        }
    };

    const formatDateTime = (value: string) =>
        new Date(value).toLocaleString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });

    const canSave = formData.url.trim().length > 0 && formData.events.length > 0;

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-warm-900 flex items-center gap-2">
                            <WebhookIcon className="w-7 h-7 text-primary-600" />
                            Webhooks
                        </h1>
                        <p className="text-warm-600 mt-1">
                            Send HR events to another system as they happen
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={loadData} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
                            Refresh
                        </Button>
                        <Button onClick={openCreateModal}>
                            <Plus className="w-4 h-4 mr-2" />
                            Add Webhook
                        </Button>
                    </div>
                </div>

                {/* List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : webhooks.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <WebhookIcon className="w-16 h-16 text-warm-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-warm-900 mb-2">
                                No Webhooks Yet
                            </h3>
                            <p className="text-warm-600 mb-4">
                                Add an endpoint and HRMS will POST to it whenever a
                                subscribed event happens.
                            </p>
                            <Button onClick={openCreateModal}>
                                <Plus className="w-4 h-4 mr-2" />
                                Add Webhook
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-warm-200 bg-warm-50">
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Endpoint
                                        </th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Events
                                        </th>
                                        <th className="text-left px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Status
                                        </th>
                                        <th className="text-right px-4 py-3 text-xs font-medium text-warm-500 uppercase">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-warm-200">
                                    {webhooks.map((webhook) => (
                                        <tr
                                            key={webhook.id}
                                            className={cn(
                                                'hover:bg-warm-50 transition-colors',
                                                !webhook.isActive && 'opacity-60'
                                            )}
                                        >
                                            <td className="px-4 py-3">
                                                <p className="text-sm font-medium text-warm-900 break-all">
                                                    {webhook.url}
                                                </p>
                                                {webhook.description && (
                                                    <p className="text-xs text-warm-500 mt-0.5">
                                                        {webhook.description}
                                                    </p>
                                                )}
                                                <p className="text-xs text-warm-400 mt-0.5 flex items-center gap-1">
                                                    <KeyRound className="w-3 h-3" />
                                                    {webhook.hasSecret
                                                        ? `Signed (${webhook.secretHint})`
                                                        : 'Unsigned'}
                                                </p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-wrap gap-1">
                                                    {webhook.events.map((event) => (
                                                        <Badge key={event} variant="info">
                                                            {event}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <Badge
                                                    variant={webhook.isActive ? 'success' : 'gray'}
                                                >
                                                    {webhook.isActive ? 'Active' : 'Inactive'}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 text-right whitespace-nowrap">
                                                <button
                                                    onClick={() => handleTest(webhook)}
                                                    disabled={testingId === webhook.id}
                                                    title="Send test"
                                                    aria-label={`Send test to ${webhook.url}`}
                                                    className="p-2 text-warm-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors disabled:opacity-50"
                                                >
                                                    <Send
                                                        className={cn(
                                                            'w-4 h-4',
                                                            testingId === webhook.id && 'animate-pulse'
                                                        )}
                                                    />
                                                </button>
                                                <button
                                                    onClick={() => openLogs(webhook)}
                                                    title="Delivery log"
                                                    aria-label={`Delivery log for ${webhook.url}`}
                                                    className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                                                >
                                                    <ScrollText className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => openEditModal(webhook)}
                                                    title="Edit"
                                                    aria-label={`Edit ${webhook.url}`}
                                                    className="p-2 text-warm-400 hover:text-warm-600 hover:bg-warm-100 rounded-lg transition-colors"
                                                >
                                                    <Edit2 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={() => setDeleting(webhook)}
                                                    title="Delete"
                                                    aria-label={`Delete ${webhook.url}`}
                                                    className="p-2 text-warm-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                >
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

            {/* Create / Edit */}
            <Modal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editing ? 'Edit Webhook' : 'Add Webhook'}
                size="xl"
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                            Endpoint URL *
                        </label>
                        <input
                            type="url"
                            value={formData.url}
                            onChange={(e) =>
                                setFormData({ ...formData, url: e.target.value })
                            }
                            placeholder="https://example.com/hooks/hrms"
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                            Signing Secret
                        </label>
                        <input
                            type="password"
                            value={formData.secret}
                            onChange={(e) =>
                                setFormData({ ...formData, secret: e.target.value })
                            }
                            placeholder={
                                editing?.hasSecret
                                    ? 'Leave blank to keep the current secret'
                                    : 'Optional — used to sign each delivery'
                            }
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                        <p className="text-xs text-warm-500 mt-1">
                            When set, every delivery carries an{' '}
                            <code>X-HRMS-Signature</code> header so the receiver can
                            verify it came from us.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-1">
                            Description
                        </label>
                        <input
                            type="text"
                            value={formData.description}
                            onChange={(e) =>
                                setFormData({ ...formData, description: e.target.value })
                            }
                            placeholder="What is on the other end of this?"
                            className="w-full px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-warm-700 mb-2">
                            Events *
                        </label>
                        {availableEvents.length === 0 ? (
                            <p className="text-sm text-warm-500">
                                No events are available.
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-warm-200 rounded-lg p-3">
                                {availableEvents.map((event) => (
                                    <label
                                        key={event}
                                        className="flex items-center gap-2 cursor-pointer text-sm text-warm-700"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={formData.events.includes(event)}
                                            onChange={() => toggleEvent(event)}
                                            className="w-4 h-4 text-primary-600 border-warm-300 rounded focus:ring-primary-500"
                                        />
                                        <span className="font-mono text-xs">{event}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={formData.isActive}
                            onChange={(e) =>
                                setFormData({ ...formData, isActive: e.target.checked })
                            }
                            className="w-4 h-4 text-primary-600 border-warm-300 rounded focus:ring-primary-500"
                        />
                        <span className="text-sm text-warm-700">Active</span>
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
                    <Button onClick={handleSave} loading={saving} disabled={!canSave}>
                        {editing ? 'Update' : 'Create'}
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delete confirmation */}
            <Modal
                isOpen={Boolean(deleting)}
                onClose={() => setDeleting(null)}
                title="Delete Webhook"
                size="sm"
            >
                <p className="text-warm-600">
                    Delete <strong>{deleting?.url}</strong>? Its delivery history goes
                    with it, and nothing will be sent to this endpoint again.
                </p>
                <ModalFooter>
                    <Button
                        variant="secondary"
                        onClick={() => setDeleting(null)}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button variant="danger" onClick={handleDelete} loading={saving}>
                        Delete
                    </Button>
                </ModalFooter>
            </Modal>

            {/* Delivery log */}
            <Modal
                isOpen={Boolean(logsFor)}
                onClose={() => setLogsFor(null)}
                title="Delivery Log"
                size="2xl"
            >
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <p className="text-sm text-warm-500 break-all flex-1">
                            {logsFor?.url}
                        </p>
                        <select
                            value={logStatusFilter}
                            onChange={(e) => changeLogFilter(e.target.value)}
                            aria-label="Filter deliveries by status"
                            className="px-3 py-2 border border-warm-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="">All Statuses</option>
                            <option value="SUCCESS">Success</option>
                            <option value="FAILED">Failed</option>
                            <option value="RETRYING">Retrying</option>
                        </select>
                    </div>

                    {logsLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary-600 border-t-transparent" />
                        </div>
                    ) : logs.length === 0 ? (
                        <div className="py-12 text-center">
                            <ScrollText className="w-12 h-12 text-warm-300 mx-auto mb-3" />
                            <p className="text-warm-600">No deliveries recorded yet.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-warm-200 bg-warm-50">
                                        <th className="text-left px-3 py-2 text-xs font-medium text-warm-500 uppercase">
                                            When
                                        </th>
                                        <th className="text-left px-3 py-2 text-xs font-medium text-warm-500 uppercase">
                                            Event
                                        </th>
                                        <th className="text-left px-3 py-2 text-xs font-medium text-warm-500 uppercase">
                                            Status
                                        </th>
                                        <th className="text-left px-3 py-2 text-xs font-medium text-warm-500 uppercase">
                                            Attempts
                                        </th>
                                        <th className="text-left px-3 py-2 text-xs font-medium text-warm-500 uppercase">
                                            Detail
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-warm-200">
                                    {logs.map((log) => (
                                        <tr key={log.id}>
                                            <td className="px-3 py-2 text-sm whitespace-nowrap">
                                                {formatDateTime(log.triggeredAt)}
                                            </td>
                                            <td className="px-3 py-2 text-xs font-mono">
                                                {log.event}
                                            </td>
                                            <td className="px-3 py-2 whitespace-nowrap">
                                                <Badge variant={statusVariants[log.status]}>
                                                    {log.status}
                                                </Badge>
                                                {log.httpStatus != null && (
                                                    <span className="ml-1 text-xs text-warm-500">
                                                        {log.httpStatus}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-sm">
                                                {log.attemptCount}
                                            </td>
                                            <td className="px-3 py-2 text-xs text-warm-500 max-w-xs truncate">
                                                {log.errorMessage || log.responseBody || '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <ModalFooter>
                    <Button variant="secondary" onClick={() => setLogsFor(null)}>
                        Close
                    </Button>
                </ModalFooter>
            </Modal>
        </>
    );
}
