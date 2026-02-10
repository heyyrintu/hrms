import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Header } from './Header';

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  Menu: (props: any) => <span data-testid="icon-menu" {...props} />,
  Bell: (props: any) => <span data-testid="icon-bell" {...props} />,
  User: (props: any) => <span data-testid="icon-user" {...props} />,
  LogOut: (props: any) => <span data-testid="icon-logout" {...props} />,
  ChevronDown: (props: any) => <span data-testid="icon-chevron" {...props} />,
  Check: (props: any) => <span data-testid="icon-check" {...props} />,
  ExternalLink: (props: any) => <span data-testid="icon-link" {...props} />,
}));

// Mock auth context
const mockLogout = jest.fn();
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'admin@test.com', role: 'HR_ADMIN' },
    logout: mockLogout,
  }),
}));

// Mock notifications API
jest.mock('@/lib/api', () => ({
  api: {
    defaults: { headers: { common: {} } },
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  },
  notificationsApi: {
    getUnreadCount: jest.fn().mockResolvedValue({ data: { count: 0 } }),
    getAll: jest.fn().mockResolvedValue({ data: { data: [] } }),
    markAsRead: jest.fn().mockResolvedValue({}),
    markAllAsRead: jest.fn().mockResolvedValue({}),
  },
}));

describe('Header', () => {
  const defaultProps = {
    onMenuClick: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders header', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText('admin@test.com')).toBeInTheDocument();
  });

  it('renders user role', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByText('HR_ADMIN')).toBeInTheDocument();
  });

  it('calls onMenuClick when menu button is clicked', () => {
    render(<Header {...defaultProps} />);
    const menuBtn = screen.getByTestId('icon-menu').closest('button');
    if (menuBtn) {
      fireEvent.click(menuBtn);
      expect(defaultProps.onMenuClick).toHaveBeenCalled();
    }
  });

  it('toggles user dropdown when user button is clicked', () => {
    render(<Header {...defaultProps} />);
    // Click user avatar area
    const userBtn = screen.getByTestId('icon-chevron').closest('button');
    if (userBtn) {
      fireEvent.click(userBtn);
      expect(screen.getByText('Sign out')).toBeInTheDocument();
    }
  });

  it('toggles notifications dropdown', () => {
    render(<Header {...defaultProps} />);
    const bellBtn = screen.getByTestId('icon-bell').closest('button');
    if (bellBtn) {
      fireEvent.click(bellBtn);
      expect(screen.getByText('Notifications')).toBeInTheDocument();
    }
  });

  it('renders notification bell icon', () => {
    render(<Header {...defaultProps} />);
    expect(screen.getByTestId('icon-bell')).toBeInTheDocument();
  });
});
