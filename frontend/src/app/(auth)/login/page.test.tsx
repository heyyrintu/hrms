import React from 'react';
import { render, screen } from '@testing-library/react';
import LoginPage from './page';

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

// Mock AuthContext - login page uses isAuthenticated=false so it doesn't redirect
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isManager: false,
    isAdmin: false,
    isSuperAdmin: false,
    hasRole: jest.fn().mockReturnValue(false),
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// Mock UI components
jest.mock('@/components/ui', () => ({
  Button: ({ children, loading, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  Input: ({ label, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <input aria-label={label} {...props} />
    </div>
  ),
  FormError: ({ message }: any) =>
    message ? <div role="alert">{message}</div> : null,
}));

describe('LoginPage', () => {
  it('renders the welcome heading', () => {
    render(<LoginPage />);
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
  });

  it('renders the sign in subtitle', () => {
    render(<LoginPage />);
    expect(screen.getByText('Sign in to your HRMS workspace')).toBeInTheDocument();
  });

  it('renders email and password inputs', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('renders demo account information', () => {
    render(<LoginPage />);
    expect(screen.getByText(/Demo accounts/)).toBeInTheDocument();
    expect(screen.getByText('HR Admin')).toBeInTheDocument();
  });
});
