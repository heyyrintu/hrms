import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import PayrollPage from './page';

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
});
