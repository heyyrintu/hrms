import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import SecurityUsersTab from './SecurityUsersTab';
import { securityApi } from '@/lib/api-security';
import { useAuth } from '@/contexts/AuthContext';
import { UserRole } from '@/types';
import { SecurityUserRow } from '@/types/security';

jest.mock('@/lib/api-security', () => ({
  securityApi: {
    getUsers: jest.fn(),
    getRoles: jest.fn(),
    setUserRoles: jest.fn(),
    resetUserTwoFactor: jest.fn(),
  },
}));

jest.mock('@/contexts/AuthContext', () => ({ useAuth: jest.fn() }));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const mockedApi = securityApi as jest.Mocked<typeof securityApi>;
const mockedUseAuth = useAuth as unknown as jest.Mock;

const roles = [
  { id: 'role-1', name: 'Payroll Lead', description: null, permissions: ['org.manage'], userCount: 1, createdAt: '', updatedAt: '' },
  { id: 'role-2', name: 'Recruiter', description: null, permissions: ['recruitment.config.manage'], userCount: 0, createdAt: '', updatedAt: '' },
];

const employeeUser: SecurityUserRow = {
  id: 'user-1',
  email: 'jane@test.com',
  role: UserRole.EMPLOYEE,
  isActive: true,
  employeeName: 'Jane Doe',
  twoFactorEnabled: true,
  customRoles: [{ id: 'role-1', name: 'Payroll Lead' }],
  ssoProviders: ['GOOGLE'],
};

const superAdminUser: SecurityUserRow = {
  id: 'user-2',
  email: 'root@test.com',
  role: UserRole.SUPER_ADMIN,
  isActive: true,
  employeeName: null,
  twoFactorEnabled: false,
  customRoles: [],
  ssoProviders: [],
};

function mockList(
  data: SecurityUserRow[] = [employeeUser],
  meta = { total: 1, page: 1, limit: 20, totalPages: 1 },
) {
  mockedApi.getUsers.mockResolvedValue({ data: { data, meta } } as any);
}

describe('SecurityUsersTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({ isSuperAdmin: false });
    mockedApi.getRoles.mockResolvedValue({ data: roles } as any);
  });

  it('lists users with email, name, role, custom role chips, 2FA and SSO badges', async () => {
    mockList();

    render(<SecurityUsersTab />);

    await waitFor(() => expect(screen.getByText('jane@test.com')).toBeInTheDocument());
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('Payroll Lead')).toBeInTheDocument();
    expect(screen.getByText('GOOGLE')).toBeInTheDocument();
  });

  it('debounces search input before calling the API again', async () => {
    jest.useFakeTimers({ advanceTimers: true });
    mockList();
    const user = userEvent.setup({ delay: null });

    render(<SecurityUsersTab />);
    await waitFor(() => expect(mockedApi.getUsers).toHaveBeenCalledTimes(1));

    await user.type(screen.getByPlaceholderText(/search/i), 'jane');

    // still just the initial call before the debounce window elapses
    expect(mockedApi.getUsers).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() =>
      expect(mockedApi.getUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'jane' }),
      ),
    );
    jest.useRealTimers();
  });

  it('opens the roles dialog, toggles a role, and saves', async () => {
    mockList();
    mockedApi.setUserRoles.mockResolvedValue({ data: [] } as any);
    const user = userEvent.setup();

    render(<SecurityUsersTab />);
    await waitFor(() => expect(screen.getByText('jane@test.com')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /roles/i }));

    expect(await screen.findByLabelText('Recruiter')).toBeInTheDocument();
    expect(screen.getByLabelText('Payroll Lead')).toBeChecked();

    await user.click(screen.getByLabelText('Recruiter'));
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockedApi.setUserRoles).toHaveBeenCalledWith(
        'user-1',
        expect.arrayContaining(['role-1', 'role-2']),
      ),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows an error toast when saving roles fails', async () => {
    mockList();
    mockedApi.setUserRoles.mockRejectedValue({ response: { data: { message: 'nope' } } });
    const user = userEvent.setup();

    render(<SecurityUsersTab />);
    await waitFor(() => expect(screen.getByText('jane@test.com')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /roles/i }));
    await screen.findByLabelText('Recruiter');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'));
  });

  it('disables Reset 2FA when the user has not enabled it', async () => {
    mockList([{ ...employeeUser, twoFactorEnabled: false }]);

    render(<SecurityUsersTab />);
    await waitFor(() => expect(screen.getByText('jane@test.com')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /reset 2fa/i })).toBeDisabled();
  });

  it('hides Reset 2FA for a SUPER_ADMIN row unless the viewer is SUPER_ADMIN', async () => {
    mockList([{ ...superAdminUser, twoFactorEnabled: true }]);
    mockedUseAuth.mockReturnValue({ isSuperAdmin: false });

    render(<SecurityUsersTab />);
    await waitFor(() => expect(screen.getByText('root@test.com')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /reset 2fa/i })).not.toBeInTheDocument();
  });

  it('shows Reset 2FA for a SUPER_ADMIN row when the viewer is SUPER_ADMIN', async () => {
    mockList([{ ...superAdminUser, twoFactorEnabled: true }]);
    mockedUseAuth.mockReturnValue({ isSuperAdmin: true });

    render(<SecurityUsersTab />);
    await waitFor(() => expect(screen.getByText('root@test.com')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /reset 2fa/i })).toBeEnabled();
  });

  it('resets 2FA after a confirm and reloads', async () => {
    mockList();
    mockedApi.resetUserTwoFactor.mockResolvedValue({} as any);
    const user = userEvent.setup();

    render(<SecurityUsersTab />);
    await waitFor(() => expect(screen.getByText('jane@test.com')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /reset 2fa/i }));
    await user.click(screen.getByRole('button', { name: /confirm|yes, reset/i }));

    await waitFor(() => expect(mockedApi.resetUserTwoFactor).toHaveBeenCalledWith('user-1'));
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows an error toast when resetting 2FA fails', async () => {
    mockList();
    mockedApi.resetUserTwoFactor.mockRejectedValue({ response: { data: { message: 'boom' } } });
    const user = userEvent.setup();

    render(<SecurityUsersTab />);
    await waitFor(() => expect(screen.getByText('jane@test.com')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /reset 2fa/i }));
    await user.click(screen.getByRole('button', { name: /confirm|yes, reset/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
  });
});
