'use client';

import { useEffect, useState, useCallback } from 'react';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { notificationsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import {
    Bell,
    Check,
    CheckCheck,
    Trash2,
    RefreshCw,
    Filter,
    Calendar,
    Clock,
    FileText,
    Megaphone,
    AlertCircle,
} from 'lucide-react';
import { NotificationType } from '@/types';

interface Notification {
    id: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    isRead: boolean;
    createdAt: string;
}

const typeIcons: Partial<Record<NotificationType, React.ReactNode>> = {
    [NotificationType.LEAVE_APPROVED]: <Calendar className="w-4 h-4 text-green-600" />,
    [NotificationType.LEAVE_REJECTED]: <Calendar className="w-4 h-4 text-red-600" />,
    [NotificationType.OT_APPROVED]: <Clock className="w-4 h-4 text-green-600" />,
    [NotificationType.OT_REJECTED]: <Clock className="w-4 h-4 text-red-600" />,
    [NotificationType.CHANGE_REQUEST_APPROVED]: <FileText className="w-4 h-4 text-green-600" />,
    [NotificationType.CHANGE_REQUEST_REJECTED]: <FileText className="w-4 h-4 text-red-600" />,
    [NotificationType.DOCUMENT_VERIFIED]: <Check className="w-4 h-4 text-blue-600" />,
    [NotificationType.SHIFT_ASSIGNED]: <Clock className="w-4 h-4 text-purple-600" />,
    [NotificationType.ANNOUNCEMENT]: <Megaphone className="w-4 h-4 text-orange-600" />,
    [NotificationType.GENERAL]: <AlertCircle className="w-4 h-4 text-gray-600" />,
};

export default function NotificationsPage() {
    const router = useRouter();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [unreadCount, setUnreadCount] = useState(0);
    const [filterUnread, setFilterUnread] = useState(false);

    const loadNotifications = useCallback(async () => {
        setLoading(true);
        try {
            const params: Record<string, unknown> = { page, limit: 20 };
            if (filterUnread) params.unreadOnly = true;
            const res = await notificationsApi.getAll(params);
            setNotifications(res.data.data || []);
            setTotalPages(res.data.meta?.totalPages || 1);
        } catch {
            // Silently fail
        } finally {
            setLoading(false);
        }
    }, [page, filterUnread]);

    const fetchUnreadCount = useCallback(async () => {
        try {
            const res = await notificationsApi.getUnreadCount();
            setUnreadCount(res.data.count);
        } catch {
            // Silently fail
        }
    }, []);

    useEffect(() => {
        loadNotifications();
    }, [loadNotifications]);

    useEffect(() => {
        fetchUnreadCount();
    }, [fetchUnreadCount]);

    const handleMarkAsRead = async (id: string) => {
        await notificationsApi.markAsRead(id).catch(() => {});
        setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
    };

    const handleMarkAllRead = async () => {
        await notificationsApi.markAllAsRead().catch(() => {});
        setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
    };

    const handleDelete = async (id: string) => {
        await notificationsApi.delete(id).catch(() => {});
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    };

    const handleClick = async (notif: Notification) => {
        if (!notif.isRead) {
            await handleMarkAsRead(notif.id);
        }
        if (notif.link) {
            router.push(notif.link);
        }
    };

    const timeAgo = (dateStr: string) => {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d ago`;
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        });
    };

    return (
        <>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                            <Bell className="w-7 h-7 text-primary-600" />
                            Notifications
                            {unreadCount > 0 && (
                                <Badge variant="danger">{unreadCount} unread</Badge>
                            )}
                        </h1>
                        <p className="text-gray-600 mt-1">
                            Stay updated with your latest activity
                        </p>
                    </div>
                    <div className="flex gap-3">
                        <Button
                            variant="secondary"
                            onClick={() => {
                                setFilterUnread(!filterUnread);
                                setPage(1);
                            }}
                        >
                            <Filter className={cn('w-4 h-4 mr-2', filterUnread && 'text-primary-600')} />
                            {filterUnread ? 'Show All' : 'Unread Only'}
                        </Button>
                        {unreadCount > 0 && (
                            <Button variant="secondary" onClick={handleMarkAllRead}>
                                <CheckCheck className="w-4 h-4 mr-2" />
                                Mark All Read
                            </Button>
                        )}
                        <Button variant="secondary" onClick={loadNotifications} disabled={loading}>
                            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                        </Button>
                    </div>
                </div>

                {/* Notifications List */}
                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
                    </div>
                ) : notifications.length === 0 ? (
                    <Card>
                        <CardContent className="py-16 text-center">
                            <Bell className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                No Notifications
                            </h3>
                            <p className="text-gray-600">
                                {filterUnread
                                    ? "You're all caught up! No unread notifications."
                                    : 'You have no notifications yet.'}
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <Card>
                        <div className="divide-y divide-gray-100">
                            {notifications.map((notif) => (
                                <div
                                    key={notif.id}
                                    className={cn(
                                        'flex items-start gap-4 px-4 py-4 transition-colors',
                                        !notif.isRead && 'bg-primary-50/50',
                                        notif.link && 'cursor-pointer hover:bg-gray-50',
                                    )}
                                    onClick={() => handleClick(notif)}
                                >
                                    <div className="flex-shrink-0 mt-0.5">
                                        <div
                                            className={cn(
                                                'w-9 h-9 rounded-full flex items-center justify-center',
                                                !notif.isRead
                                                    ? 'bg-primary-100'
                                                    : 'bg-gray-100',
                                            )}
                                        >
                                            {typeIcons[notif.type] || (
                                                <Bell className="w-4 h-4 text-gray-500" />
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <p
                                                    className={cn(
                                                        'text-sm',
                                                        !notif.isRead
                                                            ? 'font-semibold text-gray-900'
                                                            : 'font-medium text-gray-700',
                                                    )}
                                                >
                                                    {notif.title}
                                                </p>
                                                <p className="text-sm text-gray-600 mt-0.5">
                                                    {notif.message}
                                                </p>
                                                <p className="text-xs text-gray-400 mt-1">
                                                    {timeAgo(notif.createdAt)}
                                                </p>
                                            </div>

                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                {!notif.isRead && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleMarkAsRead(notif.id);
                                                        }}
                                                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                                        title="Mark as read"
                                                    >
                                                        <Check className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDelete(notif.id);
                                                    }}
                                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
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
                    </Card>
                )}
            </div>
        </>
    );
}
