import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ExpensesPage from './page';

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

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

// Mock API
jest.mock('@/lib/api', () => ({
  expensesApi: {
    getMyClaims: jest.fn().mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } },
    }),
    getCategories: jest.fn().mockResolvedValue({ data: [] }),
    createClaim: jest.fn(),
    updateClaim: jest.fn(),
    submitClaim: jest.fn(),
    deleteClaim: jest.fn(),
  },
}));

// Mock utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Mock types
jest.mock('@/types', () => ({
  ExpenseClaimStatus: {
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    REIMBURSED: 'REIMBURSED',
  },
  ExpenseClaim: {},
  ExpenseCategory: {},
}));

describe('ExpensesPage', () => {
  it('renders the My Expenses heading after loading', async () => {
    render(<ExpensesPage />);

    await waitFor(() => {
      expect(screen.getByText('My Expenses')).toBeInTheDocument();
    });
  });

  it('renders the subtitle after loading', async () => {
    render(<ExpensesPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Submit and track your expense claims'),
      ).toBeInTheDocument();
    });
  });

  it('renders the New Claim button after loading', async () => {
    render(<ExpensesPage />);

    await waitFor(() => {
      // There may be multiple "New Claim" buttons (header + empty state)
      const buttons = screen.getAllByText('New Claim');
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders stat cards after loading', async () => {
    render(<ExpensesPage />);

    await waitFor(() => {
      expect(screen.getByText('Total Claimed')).toBeInTheDocument();
      expect(screen.getByText('Pending Approval')).toBeInTheDocument();
    });
  });

  it('renders No Expense Claims empty state when no data', async () => {
    render(<ExpensesPage />);

    await waitFor(() => {
      expect(screen.getByText('No Expense Claims')).toBeInTheDocument();
    });
  });

  it('renders the search input after loading', async () => {
    render(<ExpensesPage />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search claims...')).toBeInTheDocument();
    });
  });
});
