import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ExpensesPage from './page';
import { expensesApi } from '@/lib/api';

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

  /**
   * Claim amounts arrive as decimal strings, because the backend holds
   * `expense_claims.amount` as a Prisma `Decimal`. Added as floats these
   * three come to 44967.49999999999, so the card reports a rupee less than
   * was claimed.
   */
  it('totals claims exactly, without adding them as floats', async () => {
    const claim = (id: string, amount: string, status: string) => ({
      id,
      tenantId: 't1',
      employeeId: 'e1',
      categoryId: 'c1',
      category: { id: 'c1', name: 'Travel' },
      amount,
      description: `Claim ${id}`,
      expenseDate: '2026-01-15T00:00:00.000Z',
      status,
      createdAt: '2026-01-15T00:00:00.000Z',
      updatedAt: '2026-01-15T00:00:00.000Z',
    });

    (expensesApi.getMyClaims as jest.Mock).mockResolvedValueOnce({
      data: {
        data: [
          claim('a', '16801.51', 'APPROVED'),
          claim('b', '24828.50', 'REIMBURSED'),
          claim('c', '3337.49', 'APPROVED'),
        ],
        meta: { total: 3, page: 1, limit: 20, totalPages: 1 },
      },
    });

    render(<ExpensesPage />);

    // The stat cards render before the claims arrive, so wait for a row.
    await waitFor(() => {
      expect(screen.getByText('Claim a')).toBeInTheDocument();
    });

    expect(screen.getByText('Total Claimed').previousElementSibling).toHaveTextContent(
      '₹44,968',
    );
    expect(
      screen.getByText('Approved / Reimbursed').previousElementSibling,
    ).toHaveTextContent('₹44,968');
  });
});
