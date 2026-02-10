import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import EmployeesPage from './page';

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

// Mock UI components
jest.mock('@/components/ui', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardTitle: ({ children, ...props }: any) => <h3 {...props}>{children}</h3>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  Table: ({ children, ...props }: any) => <table {...props}>{children}</table>,
  TableHeader: ({ children, ...props }: any) => <thead {...props}>{children}</thead>,
  TableBody: ({ children, ...props }: any) => <tbody {...props}>{children}</tbody>,
  TableRow: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
  TableHead: ({ children, ...props }: any) => <th {...props}>{children}</th>,
  TableCell: ({ children, ...props }: any) => <td {...props}>{children}</td>,
  TableEmptyState: ({ message, colSpan }: any) => (
    <tr><td colSpan={colSpan}>{message}</td></tr>
  ),
  TableLoadingState: ({ colSpan }: any) => (
    <tr><td colSpan={colSpan}>Loading...</td></tr>
  ),
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  getStatusBadgeVariant: jest.fn().mockReturnValue('gray'),
  Select: ({ label, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <select {...props} />
    </div>
  ),
  Input: ({ label, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <input aria-label={label} {...props} />
    </div>
  ),
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  Modal: ({ children, isOpen }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalFooter: ({ children }: any) => <div>{children}</div>,
  FormRow: ({ children }: any) => <div>{children}</div>,
  FormGrid: ({ children }: any) => <div>{children}</div>,
  FormError: ({ message }: any) => (message ? <div role="alert">{message}</div> : null),
  FormSuccess: ({ message }: any) => (message ? <div>{message}</div> : null),
}));

// Mock API modules
jest.mock('@/lib/api', () => ({
  employeesApi: {
    getAll: jest.fn().mockResolvedValue({
      data: { data: [], meta: { total: 0 } },
    }),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  departmentsApi: {
    getAll: jest.fn().mockResolvedValue({ data: [] }),
  },
}));

// Mock types
jest.mock('@/types', () => ({
  EmploymentType: {
    PERMANENT: 'PERMANENT',
    CONTRACT: 'CONTRACT',
    TEMPORARY: 'TEMPORARY',
    INTERN: 'INTERN',
  },
  PayType: {
    MONTHLY: 'MONTHLY',
    HOURLY: 'HOURLY',
  },
  EmployeeStatus: {
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
  },
}));

describe('EmployeesPage', () => {
  it('renders the Employees heading', async () => {
    render(<EmployeesPage />);
    expect(screen.getByText('Employees')).toBeInTheDocument();
  });

  it('renders the subtitle text', () => {
    render(<EmployeesPage />);
    expect(
      screen.getByText('Manage and view employee information'),
    ).toBeInTheDocument();
  });

  it('renders Add Employee button for admins', () => {
    render(<EmployeesPage />);
    expect(screen.getByText('Add Employee')).toBeInTheDocument();
  });

  it('renders the search placeholder', () => {
    render(<EmployeesPage />);
    expect(
      screen.getByPlaceholderText('Search by name, email, or employee code...'),
    ).toBeInTheDocument();
  });
});
