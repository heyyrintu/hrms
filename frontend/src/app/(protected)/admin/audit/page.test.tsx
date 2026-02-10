import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import AuditLogsPage from './page';

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
  auditApi: {
    getLogs: jest.fn().mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 25, totalPages: 0 } },
    }),
  },
}));

// Mock @/types
jest.mock('@/types', () => ({
  AuditAction: { CREATE: 'CREATE', UPDATE: 'UPDATE', DELETE: 'DELETE', LOGIN: 'LOGIN' },
}));

describe('AuditLogsPage', () => {
  it('renders the Audit Logs heading', async () => {
    render(<AuditLogsPage />);
    await waitFor(() => {
      expect(screen.getByText('Audit Logs')).toBeInTheDocument();
    });
  });

  it('renders the subtitle text', async () => {
    render(<AuditLogsPage />);
    await waitFor(() => {
      expect(screen.getByText('Track all changes and activities across the system')).toBeInTheDocument();
    });
  });

  it('renders the empty state when no logs exist', async () => {
    render(<AuditLogsPage />);
    await waitFor(() => {
      expect(screen.getByText('No audit logs found')).toBeInTheDocument();
    });
  });

  it('renders the Refresh button', async () => {
    render(<AuditLogsPage />);
    await waitFor(() => {
      expect(screen.getByText('Refresh')).toBeInTheDocument();
    });
  });
});
