import { render, screen } from '@testing-library/react';
import AdminLayout from './layout';
import { useAuth } from '@/contexts/AuthContext';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: jest.fn() }));

const mockedUseAuth = useAuth as unknown as jest.Mock;

describe('AdminLayout', () => {
  it('renders the page for an administrator', () => {
    mockedUseAuth.mockReturnValue({ isAdmin: true, isLoading: false });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });

  it('withholds admin pages from a non-administrator', () => {
    mockedUseAuth.mockReturnValue({ isAdmin: false, isLoading: false });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    expect(
      screen.getByText(/do not have access to this page/i),
    ).toBeInTheDocument();
  });

  it('shows neither content nor a denial while the session is still loading', () => {
    mockedUseAuth.mockReturnValue({ isAdmin: false, isLoading: true });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/do not have access to this page/i),
    ).not.toBeInTheDocument();
  });
});
