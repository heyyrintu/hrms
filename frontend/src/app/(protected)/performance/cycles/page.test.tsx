import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ReviewCyclesPage from './page';

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
  performanceApi: {
    getCycles: jest.fn().mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } },
    }),
    createCycle: jest.fn(),
    updateCycle: jest.fn(),
    deleteCycle: jest.fn(),
    launchCycle: jest.fn(),
    completeCycle: jest.fn(),
  },
}));

// Mock @/types
jest.mock('@/types', () => ({
  ReviewCycleStatus: { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED' },
}));

describe('ReviewCyclesPage', () => {
  it('renders the Review Cycles heading', async () => {
    render(<ReviewCyclesPage />);
    await waitFor(() => {
      expect(screen.getByText('Review Cycles')).toBeInTheDocument();
    });
  });

  it('renders the Create Cycle button', async () => {
    render(<ReviewCyclesPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Create Cycle').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the empty state when no cycles exist', async () => {
    render(<ReviewCyclesPage />);
    await waitFor(() => {
      expect(screen.getByText('No review cycles')).toBeInTheDocument();
    });
  });
});
