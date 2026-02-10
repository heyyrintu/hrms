import React from 'react';
import { render, screen } from '@testing-library/react';
import LeaveRequestPage from './page';

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

// Mock the LeaveRequestForm component since it has its own complex dependencies
jest.mock('@/components/leave/LeaveRequestForm', () => ({
  LeaveRequestForm: ({ onSuccess, onCancel }: any) => (
    <div data-testid="leave-request-form">
      <button onClick={onSuccess}>Submit Mock</button>
      <button onClick={onCancel}>Cancel Mock</button>
    </div>
  ),
}));

describe('LeaveRequestPage', () => {
  it('renders the Apply for Leave heading', () => {
    render(<LeaveRequestPage />);
    expect(screen.getByText('Apply for Leave')).toBeInTheDocument();
  });

  it('renders the subtitle', () => {
    render(<LeaveRequestPage />);
    expect(
      screen.getByText(
        'Fill in the details below to submit your leave request for approval.',
      ),
    ).toBeInTheDocument();
  });

  it('renders Back to Leave link', () => {
    render(<LeaveRequestPage />);
    expect(screen.getByText('Back to Leave')).toBeInTheDocument();
  });

  it('renders the LeaveRequestForm component', () => {
    render(<LeaveRequestPage />);
    expect(screen.getByTestId('leave-request-form')).toBeInTheDocument();
  });
});
