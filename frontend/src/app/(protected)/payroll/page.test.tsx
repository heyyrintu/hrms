import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import PayrollPage from './page';
import { payrollApi } from '@/lib/api';

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
  payrollApi: {
    getRuns: jest.fn().mockResolvedValue({ data: [] }),
    createRun: jest.fn(),
    processRun: jest.fn(),
    approveRun: jest.fn(),
    markAsPaid: jest.fn(),
    deleteRun: jest.fn(),
  },
}));

// Mock types
jest.mock('@/types', () => ({
  PayrollRunStatus: {
    DRAFT: 'DRAFT',
    PROCESSING: 'PROCESSING',
    COMPUTED: 'COMPUTED',
    APPROVED: 'APPROVED',
    PAID: 'PAID',
  },
}));

describe('PayrollPage', () => {
  it('renders the Payroll heading after loading', async () => {
    render(<PayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('Payroll')).toBeInTheDocument();
    });
  });

  it('renders the subtitle after loading', async () => {
    render(<PayrollPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Manage payroll runs, process salaries, and generate payslips'),
      ).toBeInTheDocument();
    });
  });

  it('renders the New Run button after loading', async () => {
    render(<PayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('New Run')).toBeInTheDocument();
    });
  });

  it('renders Salary Structures button after loading', async () => {
    render(<PayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('Salary Structures')).toBeInTheDocument();
    });
  });

  it('renders stat cards after loading', async () => {
    render(<PayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('Total Runs')).toBeInTheDocument();
      expect(screen.getByText('Pending Actions')).toBeInTheDocument();
      expect(screen.getByText('Total Paid Out')).toBeInTheDocument();
    });
  });

  it('renders No Payroll Runs empty state when no data', async () => {
    render(<PayrollPage />);

    await waitFor(() => {
      expect(screen.getByText('No Payroll Runs')).toBeInTheDocument();
    });
  });

  /**
   * Run totals arrive as decimal strings, because the backend holds them as
   * Prisma `Decimal`. Added as floats these three come to 7948158.499999999,
   * which is displayed as a rupee less than was actually paid out.
   */
  it('totals paid runs exactly, without adding them as floats', async () => {
    const paidRun = (id: string, month: number, totalNet: string) => ({
      id,
      tenantId: 't1',
      month,
      year: 2026,
      status: 'PAID',
      totalGross: totalNet,
      totalDeductions: '0.00',
      totalNet,
      processedCount: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    (payrollApi.getRuns as jest.Mock).mockResolvedValueOnce({
      data: [
        paidRun('r1', 1, '448631.64'),
        paidRun('r2', 2, '6898878.10'),
        paidRun('r3', 3, '600648.76'),
      ],
    });

    render(<PayrollPage />);

    // The stat cards render before the runs arrive, so wait for a row.
    await waitFor(() => {
      expect(screen.getByText('January 2026')).toBeInTheDocument();
    });

    const totalPaidOut = screen.getByText('Total Paid Out').nextElementSibling;
    expect(totalPaidOut).toHaveTextContent('₹79,48,159');
  });
});
