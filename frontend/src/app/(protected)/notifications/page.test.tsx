import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import NotificationsPage from './page';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

// Mock AuthContext
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', role: 'HR_ADMIN', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isManager: true,
    isAdmin: true,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(true),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// Mock API modules
jest.mock('@/lib/api', () => ({
  api: { defaults: { headers: { common: {} } }, interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } },
  notificationsApi: {
    getAll: jest.fn().mockResolvedValue({
      data: { data: [], meta: { totalPages: 1 } },
    }),
    getUnreadCount: jest.fn().mockResolvedValue({ data: { count: 0 } }),
    markAsRead: jest.fn().mockResolvedValue({}),
    markAllAsRead: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
  },
}));

// Mock @/lib/utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Mock @/types
jest.mock('@/types', () => ({
  NotificationType: {
    LEAVE_APPROVED: 'LEAVE_APPROVED',
    LEAVE_REJECTED: 'LEAVE_REJECTED',
    OT_APPROVED: 'OT_APPROVED',
    OT_REJECTED: 'OT_REJECTED',
    CHANGE_REQUEST_APPROVED: 'CHANGE_REQUEST_APPROVED',
    CHANGE_REQUEST_REJECTED: 'CHANGE_REQUEST_REJECTED',
    DOCUMENT_VERIFIED: 'DOCUMENT_VERIFIED',
    SHIFT_ASSIGNED: 'SHIFT_ASSIGNED',
    ANNOUNCEMENT: 'ANNOUNCEMENT',
    GENERAL: 'GENERAL',
  },
}));

describe('NotificationsPage', () => {
  it('renders the Notifications heading', async () => {
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Notifications')).toBeInTheDocument();
    });
  });

  it('renders the empty state when no notifications exist', async () => {
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText('No Notifications')).toBeInTheDocument();
    });
  });

  it('renders the Unread Only filter button', async () => {
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Unread Only')).toBeInTheDocument();
    });
  });
});
