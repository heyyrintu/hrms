import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import OnboardingPage from './page';

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
  onboardingApi: {
    getProcesses: jest.fn().mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } },
    }),
    getProcess: jest.fn(),
    getTemplates: jest.fn().mockResolvedValue({ data: [] }),
    createProcess: jest.fn(),
    cancelProcess: jest.fn(),
    deleteProcess: jest.fn(),
  },
  employeesApi: {
    getAll: jest.fn().mockResolvedValue({ data: { data: [] } }),
  },
}));

// Mock @/lib/utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// Mock @/types
jest.mock('@/types', () => ({
  OnboardingProcessStatus: { NOT_STARTED: 'NOT_STARTED', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' },
  OnboardingTaskStatus: { PENDING: 'PENDING', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED', SKIPPED: 'SKIPPED' },
}));

describe('OnboardingPage', () => {
  it('renders the Onboarding heading', async () => {
    render(<OnboardingPage />);
    await waitFor(() => {
      expect(screen.getByText('Onboarding')).toBeInTheDocument();
    });
  });

  it('renders the stats cards', async () => {
    render(<OnboardingPage />);
    await waitFor(() => {
      expect(screen.getByText('Total Processes')).toBeInTheDocument();
      expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    });
  });

  it('renders the New Process button', async () => {
    render(<OnboardingPage />);
    await waitFor(() => {
      expect(screen.getByText('New Process')).toBeInTheDocument();
    });
  });
});
