import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CompaniesPage from './page';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

// Mock AuthContext - must be SUPER_ADMIN to see the companies page
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', role: 'SUPER_ADMIN', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isManager: false,
    isAdmin: true,
    isSuperAdmin: true,
    hasRole: jest.fn().mockReturnValue(true),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// Mock API modules
jest.mock('@/lib/api', () => ({
  api: {
    defaults: { headers: { common: {} } },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    get: jest.fn().mockImplementation((url: string) => {
      if (url === '/companies/stats') {
        return Promise.resolve({
          data: { totalCompanies: 0, activeCompanies: 0, totalEmployees: 0, totalUsers: 0 },
        });
      }
      if (url === '/companies') {
        return Promise.resolve({ data: [] });
      }
      return Promise.resolve({ data: {} });
    }),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

// Mock @/types
jest.mock('@/types', () => ({
  UserRole: { SUPER_ADMIN: 'SUPER_ADMIN', HR_ADMIN: 'HR_ADMIN', MANAGER: 'MANAGER', EMPLOYEE: 'EMPLOYEE' },
}));

describe('CompaniesPage', () => {
  it('renders the Companies heading', async () => {
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getByText('Companies')).toBeInTheDocument();
    });
  });

  it('renders the Add Company button', async () => {
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getByText('Add Company')).toBeInTheDocument();
    });
  });

  it('renders the description text', async () => {
    render(<CompaniesPage />);
    await waitFor(() => {
      expect(screen.getByText('Manage organizations in the HRMS system')).toBeInTheDocument();
    });
  });
});
