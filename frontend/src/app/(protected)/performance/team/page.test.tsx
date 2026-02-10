import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import TeamReviewsPage from './page';

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
    getTeamReviews: jest.fn().mockResolvedValue({
      data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } },
    }),
    getReview: jest.fn(),
    submitManagerReview: jest.fn(),
  },
}));

// Mock @/types
jest.mock('@/types', () => ({
  PerformanceReviewStatus: { PENDING: 'PENDING', SELF_REVIEW: 'SELF_REVIEW', MANAGER_REVIEW: 'MANAGER_REVIEW', COMPLETED: 'COMPLETED' },
}));

describe('TeamReviewsPage', () => {
  it('renders the Team Reviews heading', async () => {
    render(<TeamReviewsPage />);
    await waitFor(() => {
      expect(screen.getByText('Team Reviews')).toBeInTheDocument();
    });
  });

  it('renders the subtitle text', async () => {
    render(<TeamReviewsPage />);
    await waitFor(() => {
      expect(screen.getByText(/Review your team members/)).toBeInTheDocument();
    });
  });

  it('renders the empty state when no team reviews exist', async () => {
    render(<TeamReviewsPage />);
    await waitFor(() => {
      expect(screen.getByText('No team reviews')).toBeInTheDocument();
    });
  });
});
