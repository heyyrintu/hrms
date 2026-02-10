import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import LeavePage from './page';

// Mock lucide-react icons
jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
      },
    },
  ),
);

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

// Mock UI components - leave page imports from individual paths
jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

// Mock API
jest.mock('@/lib/api', () => ({
  leaveApi: {
    getMyBalances: jest.fn().mockResolvedValue({ data: [] }),
    getMyRequests: jest.fn().mockResolvedValue({ data: { data: [] } }),
    cancelRequest: jest.fn(),
  },
}));

// Mock utils
jest.mock('@/lib/utils', () => ({
  formatDate: jest.fn().mockReturnValue('Feb 10, 2026'),
  getStatusColor: jest.fn().mockReturnValue('bg-gray-100 text-gray-800'),
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

describe('LeavePage', () => {
  it('renders the Leave Management heading after loading', async () => {
    render(<LeavePage />);

    await waitFor(() => {
      expect(screen.getByText('Leave Management')).toBeInTheDocument();
    });
  });

  it('renders the subtitle after loading', async () => {
    render(<LeavePage />);

    await waitFor(() => {
      expect(
        screen.getByText('Track your leave balances and requests'),
      ).toBeInTheDocument();
    });
  });

  it('renders Request Leave button after loading', async () => {
    render(<LeavePage />);

    await waitFor(() => {
      expect(screen.getByText('Request Leave')).toBeInTheDocument();
    });
  });

  it('renders Leave Balances section after loading', async () => {
    render(<LeavePage />);

    await waitFor(() => {
      expect(screen.getByText('Leave Balances')).toBeInTheDocument();
    });
  });

  it('renders My Requests section after loading', async () => {
    render(<LeavePage />);

    await waitFor(() => {
      expect(screen.getByText('My Requests')).toBeInTheDocument();
    });
  });
});
