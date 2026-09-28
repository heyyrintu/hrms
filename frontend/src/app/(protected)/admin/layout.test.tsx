import { render, screen } from '@testing-library/react';
import AdminLayout from './layout';
import { useAuth } from '@/contexts/AuthContext';
import { usePathname } from 'next/navigation';

jest.mock('@/contexts/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: jest.fn() }));

const mockedUseAuth = useAuth as unknown as jest.Mock;
const mockedUsePathname = usePathname as unknown as jest.Mock;

describe('AdminLayout', () => {
  beforeEach(() => {
    mockedUsePathname.mockReturnValue('/admin/departments');
  });

  it('renders the page for an administrator', () => {
    mockedUseAuth.mockReturnValue({ isAdmin: true, isLoading: false, hasPermission: () => false });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });

  it('withholds admin pages from a non-administrator with no covering permission', () => {
    mockedUseAuth.mockReturnValue({ isAdmin: false, isLoading: false, hasPermission: () => false });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    expect(
      screen.getByText(/do not have access to this page/i),
    ).toBeInTheDocument();
  });

  it('shows neither content nor a denial while the session is still loading', () => {
    mockedUseAuth.mockReturnValue({ isAdmin: false, isLoading: true, hasPermission: () => false });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/do not have access to this page/i),
    ).not.toBeInTheDocument();
  });

  it('lets an EMPLOYEE with org.manage through on /admin/departments', () => {
    mockedUsePathname.mockReturnValue('/admin/departments');
    mockedUseAuth.mockReturnValue({
      isAdmin: false,
      isLoading: false,
      hasPermission: (key?: string) => key === 'org.manage',
    });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });

  it('still denies an EMPLOYEE with org.manage on /admin/security', () => {
    mockedUsePathname.mockReturnValue('/admin/security');
    mockedUseAuth.mockReturnValue({
      isAdmin: false,
      isLoading: false,
      hasPermission: (key?: string) => key === 'org.manage',
    });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    expect(
      screen.getByText(/do not have access to this page/i),
    ).toBeInTheDocument();
  });

  it('denies an EMPLOYEE with org.manage on an unrelated admin page (/admin/letters)', () => {
    mockedUsePathname.mockReturnValue('/admin/letters');
    mockedUseAuth.mockReturnValue({
      isAdmin: false,
      isLoading: false,
      hasPermission: (key?: string) => key === 'org.manage',
    });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
    expect(
      screen.getByText(/do not have access to this page/i),
    ).toBeInTheDocument();
  });

  it('leaves HR_ADMIN (isAdmin) access unchanged on /admin/security', () => {
    mockedUsePathname.mockReturnValue('/admin/security');
    mockedUseAuth.mockReturnValue({ isAdmin: true, isLoading: false, hasPermission: () => false });

    render(<AdminLayout><p>Admin content</p></AdminLayout>);

    expect(screen.getByText('Admin content')).toBeInTheDocument();
  });
});
