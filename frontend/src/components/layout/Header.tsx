'use client';

import { Menu, Bell, User, LogOut, ChevronDown, Check, ExternalLink } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { notificationsApi } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  createdAt: string;
}

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await notificationsApi.getUnreadCount();
      setUnreadCount(res.data.count);
    } catch {
      // Silently fail
    }
  }, []);

  const fetchNotifications = async () => {
    setLoadingNotifs(true);
    try {
      const res = await notificationsApi.getAll({ limit: 8 });
      setNotifications(res.data.data || []);
    } catch {
      // Silently fail
    } finally {
      setLoadingNotifs(false);
    }
  };

  // Poll unread count every 30 seconds
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch notifications when dropdown opens
  useEffect(() => {
    if (showNotifications) {
      fetchNotifications();
    }
  }, [showNotifications]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    window.location.href = '/login';
  };

  const handleNotificationClick = async (notif: Notification) => {
    if (!notif.isRead) {
      await notificationsApi.markAsRead(notif.id).catch(() => {});
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, isRead: true } : n)),
      );
    }
    if (notif.link) {
      setShowNotifications(false);
      router.push(notif.link);
    }
  };

  const handleMarkAllRead = async () => {
    await notificationsApi.markAllAsRead().catch(() => {});
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 sm:h-16 items-center gap-3 sm:gap-4 border-b border-warm-200 bg-white/80 backdrop-blur-md px-3 sm:px-4 lg:px-6">
      {/* Mobile menu button */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 -ml-1 rounded-lg text-warm-500 hover:text-warm-700 hover:bg-warm-100 transition-colors active:scale-95"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2 rounded-lg text-warm-500 hover:text-warm-700 hover:bg-warm-100 transition-colors active:scale-95"
          >
            <Bell className="h-[18px] w-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary-500 text-[10px] font-bold text-white ring-2 ring-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute -right-2 sm:right-0 mt-2 w-[calc(100vw-1.5rem)] sm:w-80 max-w-sm rounded-xl bg-white shadow-dropdown border border-warm-200 overflow-hidden animate-scale-in">
              <div className="flex items-center justify-between px-4 py-3 border-b border-warm-100">
                <h3 className="text-sm font-semibold text-warm-900">Notifications</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-primary-600 hover:text-primary-700 font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-[60vh] sm:max-h-80 overflow-y-auto overscroll-contain">
                {loadingNotifs ? (
                  <div className="py-8 text-center">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-500 border-t-transparent mx-auto" />
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="py-8 text-center">
                    <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-warm-100">
                      <Bell className="w-4 h-4 text-warm-400" />
                    </div>
                    <p className="text-sm text-warm-500">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={cn(
                        'w-full text-left px-4 py-3 border-b border-warm-100/50 hover:bg-warm-50 transition-colors active:bg-warm-100',
                        !notif.isRead && 'bg-primary-50/30',
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        {!notif.isRead && (
                          <span className="mt-1.5 h-2 w-2 rounded-full bg-primary-500 flex-shrink-0" />
                        )}
                        <div className={cn('flex-1 min-w-0', notif.isRead && 'ml-[18px]')}>
                          <p className="text-sm font-medium text-warm-900 truncate">
                            {notif.title}
                          </p>
                          <p className="text-xs text-warm-500 mt-0.5 line-clamp-2">
                            {notif.message}
                          </p>
                          <p className="text-xs text-warm-400 mt-1">
                            {timeAgo(notif.createdAt)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="border-t border-warm-100">
                <button
                  onClick={() => {
                    setShowNotifications(false);
                    router.push('/notifications');
                  }}
                  className="flex items-center justify-center gap-1.5 w-full px-4 py-2.5 text-sm text-primary-600 hover:bg-warm-50 font-semibold transition-colors active:bg-warm-100"
                >
                  View all notifications
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-warm-200 mx-0.5 sm:mx-1 hidden sm:block" />

        {/* User dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 sm:gap-2.5 p-1.5 rounded-lg text-warm-700 hover:bg-warm-100 transition-colors active:scale-95"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary-100 to-accent-100">
              <User className="h-3.5 w-3.5 text-primary-700" />
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-semibold text-warm-800 leading-tight">{user?.email}</p>
              <p className="text-[11px] text-warm-400 font-medium">{user?.role}</p>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-warm-400 hidden sm:block" />
          </button>

          {/* Dropdown menu */}
          {showDropdown && (
            <div className="absolute right-0 mt-2 w-[calc(100vw-1.5rem)] sm:w-52 max-w-[14rem] rounded-xl bg-white py-1 shadow-dropdown border border-warm-200 animate-scale-in">
              <div className="px-4 py-2.5 border-b border-warm-100">
                <p className="text-sm font-semibold text-warm-900 truncate">{user?.email}</p>
                <p className="text-xs text-warm-400 mt-0.5">{user?.role}</p>
              </div>
              <div className="py-1">
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-warm-600 hover:bg-warm-50 hover:text-warm-900 transition-colors active:bg-warm-100"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
