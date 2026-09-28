import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SecurityAdminPage from './page';

const mockReplace = jest.fn();
let mockParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  usePathname: () => '/admin/security',
  useSearchParams: () => mockParams,
}));

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

jest.mock('@/components/security/SsoProvidersTab', () => () => <div>sso-tab</div>);
jest.mock('@/components/security/SecurityPolicyTab', () => () => <div>policy-tab</div>);
jest.mock('@/components/security/CustomRolesTab', () => () => <div>roles-tab</div>);
jest.mock('@/components/security/SecurityUsersTab', () => () => <div>users-tab</div>);

describe('SecurityAdminPage', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockParams = new URLSearchParams();
  });

  it('opens on the single sign-on tab by default', () => {
    render(<SecurityAdminPage />);
    expect(screen.getByText('sso-tab')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Single sign-on' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens the tab named in ?tab=', () => {
    mockParams = new URLSearchParams('tab=roles');
    render(<SecurityAdminPage />);
    expect(screen.getByText('roles-tab')).toBeInTheDocument();
  });

  it('falls back to the first tab for an unknown ?tab=', () => {
    mockParams = new URLSearchParams('tab=nope');
    render(<SecurityAdminPage />);
    expect(screen.getByText('sso-tab')).toBeInTheDocument();
  });

  it('switches tabs through the URL', () => {
    render(<SecurityAdminPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Users' }));
    expect(mockReplace).toHaveBeenCalledWith('/admin/security?tab=users');
  });
});
