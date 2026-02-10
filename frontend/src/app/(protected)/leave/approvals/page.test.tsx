import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import LeaveApprovalsPage from './page';

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

// Mock UI components (imported from individual paths in this page)
jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

// Mock leave sub-components
jest.mock('@/components/leave/ApprovalCard', () => ({
  ApprovalCard: ({ request }: any) => (
    <div data-testid="approval-card">{request.employee?.firstName}</div>
  ),
}));

jest.mock('@/components/leave/BulkApprovalBar', () => ({
  BulkApprovalBar: () => <div data-testid="bulk-approval-bar" />,
}));

// Mock API
jest.mock('@/lib/api', () => ({
  leaveApi: {
    getPendingApprovals: jest.fn().mockResolvedValue({ data: [] }),
    approveRequest: jest.fn(),
    rejectRequest: jest.fn(),
  },
}));

// Mock utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

describe('LeaveApprovalsPage', () => {
  it('renders the Leave Approvals heading after loading', async () => {
    render(<LeaveApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('Leave Approvals')).toBeInTheDocument();
    });
  });

  it('renders the subtitle after loading', async () => {
    render(<LeaveApprovalsPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Review and process leave requests from your team'),
      ).toBeInTheDocument();
    });
  });

  it('renders Pending Requests stat card after loading', async () => {
    render(<LeaveApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('Pending Requests')).toBeInTheDocument();
    });
  });

  it('renders search input after loading', async () => {
    render(<LeaveApprovalsPage />);

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Search by employee name or code...'),
      ).toBeInTheDocument();
    });
  });

  it('renders No Pending Requests when list is empty', async () => {
    render(<LeaveApprovalsPage />);

    await waitFor(() => {
      expect(screen.getByText('No Pending Requests')).toBeInTheDocument();
    });
  });
});
