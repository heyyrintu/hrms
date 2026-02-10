import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import PerformancePage from './page';

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
    getMyReviews: jest.fn().mockResolvedValue({ data: { data: [] } }),
    getMyGoals: jest.fn().mockResolvedValue({ data: [] }),
    getReview: jest.fn(),
    submitSelfReview: jest.fn(),
    createGoal: jest.fn(),
    updateGoal: jest.fn(),
    deleteGoal: jest.fn(),
  },
}));

// Mock @/types
jest.mock('@/types', () => ({
  PerformanceReviewStatus: { PENDING: 'PENDING', SELF_REVIEW: 'SELF_REVIEW', MANAGER_REVIEW: 'MANAGER_REVIEW', COMPLETED: 'COMPLETED' },
  GoalStatus: { NOT_STARTED: 'NOT_STARTED', IN_PROGRESS: 'IN_PROGRESS', COMPLETED: 'COMPLETED' },
}));

describe('PerformancePage', () => {
  it('renders the My Performance heading', async () => {
    render(<PerformancePage />);
    await waitFor(() => {
      expect(screen.getByText('My Performance')).toBeInTheDocument();
    });
  });

  it('renders the Reviews and Goals tabs', async () => {
    render(<PerformancePage />);
    await waitFor(() => {
      expect(screen.getByText('My Reviews')).toBeInTheDocument();
      expect(screen.getByText('My Goals')).toBeInTheDocument();
    });
  });

  it('renders the empty reviews state', async () => {
    render(<PerformancePage />);
    await waitFor(() => {
      expect(screen.getByText('No reviews yet')).toBeInTheDocument();
    });
  });
});
