import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import SalaryStructuresPage from './page';

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
    getStructures: jest.fn().mockResolvedValue({ data: [] }),
    createStructure: jest.fn(),
    updateStructure: jest.fn(),
    deleteStructure: jest.fn(),
  },
}));

// Mock types
jest.mock('@/types', () => ({
  SalaryStructure: {},
  SalaryComponent: {},
}));

describe('SalaryStructuresPage', () => {
  it('renders the Salary Structures heading after loading', async () => {
    render(<SalaryStructuresPage />);

    await waitFor(() => {
      expect(screen.getByText('Salary Structures')).toBeInTheDocument();
    });
  });

  it('renders the subtitle after loading', async () => {
    render(<SalaryStructuresPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Define salary components and assign to employees'),
      ).toBeInTheDocument();
    });
  });

  it('renders the New Structure button after loading', async () => {
    render(<SalaryStructuresPage />);

    await waitFor(() => {
      expect(screen.getByText('New Structure')).toBeInTheDocument();
    });
  });

  it('renders Back to Payroll link', () => {
    render(<SalaryStructuresPage />);
    expect(screen.getByText('Back to Payroll')).toBeInTheDocument();
  });

  it('renders No Salary Structures empty state when no data', async () => {
    render(<SalaryStructuresPage />);

    await waitFor(() => {
      expect(screen.getByText('No Salary Structures')).toBeInTheDocument();
    });
  });
});
