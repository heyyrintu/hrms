import React from 'react';
import { render, screen } from '@testing-library/react';
import { DashboardLayout } from './DashboardLayout';

// Mock lucide-react icons
jest.mock('lucide-react', () => new Proxy({}, {
  get: (_target, prop) => {
    if (prop === '__esModule') return true;
    return (props: any) => <span data-testid={`icon-${String(prop)}`} {...props} />;
  },
}));

// Mock AuthContext
const mockAuth = {
  isAuthenticated: true,
  isLoading: false,
  user: { email: 'admin@test.com', role: 'HR_ADMIN' },
  hasRole: jest.fn().mockReturnValue(true),
  logout: jest.fn(),
};

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

// Mock Spinner
jest.mock('@/components/ui/Spinner', () => ({
  PageLoader: () => <div data-testid="page-loader">Loading...</div>,
}));

// Mock child components
jest.mock('./Sidebar', () => ({
  Sidebar: ({ isOpen }: any) => (
    <nav data-testid="sidebar" data-open={isOpen}>Sidebar</nav>
  ),
}));

jest.mock('./Header', () => ({
  Header: ({ onMenuClick }: any) => (
    <header data-testid="header">
      <button onClick={onMenuClick}>Menu</button>
    </header>
  ),
}));

describe('DashboardLayout', () => {
  it('renders children when authenticated', () => {
    render(
      <DashboardLayout>
        <div>Page content</div>
      </DashboardLayout>
    );
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('renders sidebar', () => {
    render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  });

  it('renders header', () => {
    render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );
    expect(screen.getByTestId('header')).toBeInTheDocument();
  });

  it('shows loader when loading', () => {
    mockAuth.isLoading = true;
    render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );
    expect(screen.getByTestId('page-loader')).toBeInTheDocument();
    mockAuth.isLoading = false;
  });

  it('renders nothing when not authenticated and not loading', () => {
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    const { container } = render(
      <DashboardLayout>
        <div>Content</div>
      </DashboardLayout>
    );
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    mockAuth.isAuthenticated = true;
  });
});
