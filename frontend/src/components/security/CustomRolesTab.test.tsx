import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import CustomRolesTab from './CustomRolesTab';
import { securityApi } from '@/lib/api-security';

jest.mock('@/lib/api-security', () => ({
  securityApi: {
    getRoles: jest.fn(),
    getPermissions: jest.fn(),
    createRole: jest.fn(),
    updateRole: jest.fn(),
    deleteRole: jest.fn(),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

const mockedApi = securityApi as jest.Mocked<typeof securityApi>;

const permissions = [
  { key: 'org.manage', group: 'Organisation', label: 'Manage organisation setup', description: 'desc' },
  { key: 'audit.view', group: 'Security', label: 'View audit log', description: 'desc' },
];

const roles = [
  {
    id: 'role-1',
    name: 'Payroll Lead',
    description: 'Handles payroll',
    permissions: ['org.manage'],
    userCount: 3,
    createdAt: '2026-01-01T12:00:00Z',
    updatedAt: '2026-01-01T12:00:00Z',
  },
];

function mockGetResponses(rolesData = roles, permissionsData = permissions) {
  mockedApi.getRoles.mockResolvedValue({ data: rolesData } as any);
  mockedApi.getPermissions.mockResolvedValue({ data: permissionsData } as any);
}

describe('CustomRolesTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists roles with name, description, permission count and user count', async () => {
    mockGetResponses();

    render(<CustomRolesTab />);

    await waitFor(() => expect(screen.getByText('Payroll Lead')).toBeInTheDocument());
    expect(screen.getByText('Handles payroll')).toBeInTheDocument();
    // permission count and user count show up somewhere in the row
    const row = screen.getByText('Payroll Lead').closest('tr')!;
    expect(within(row).getByText('1')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
  });

  it('shows an empty state when there are no roles', async () => {
    mockGetResponses([]);

    render(<CustomRolesTab />);

    expect(await screen.findByText(/no custom roles/i)).toBeInTheDocument();
  });

  it('opens the create dialog with permissions grouped by group', async () => {
    mockGetResponses();
    const user = userEvent.setup();

    render(<CustomRolesTab />);
    await waitFor(() => expect(screen.getByText('Payroll Lead')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /add role/i }));

    expect(screen.getByText('Organisation')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByLabelText('Manage organisation setup')).toBeInTheDocument();
    expect(screen.getByLabelText('View audit log')).toBeInTheDocument();
  });

  it('creates a role with the trimmed name and selected permissions', async () => {
    mockGetResponses();
    mockedApi.createRole.mockResolvedValue({ data: { ...roles[0], id: 'role-2' } } as any);
    const user = userEvent.setup();

    render(<CustomRolesTab />);
    await waitFor(() => expect(screen.getByText('Payroll Lead')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /add role/i }));
    await user.type(screen.getByLabelText(/name/i), '  Recruiter  ');
    await user.click(screen.getByLabelText('View audit log'));
    await user.click(screen.getByRole('button', { name: /^save$|^create$/i }));

    await waitFor(() =>
      expect(mockedApi.createRole).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Recruiter', permissions: ['audit.view'] }),
      ),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('shows a 409 message inline without closing the dialog', async () => {
    mockGetResponses();
    mockedApi.createRole.mockRejectedValue({
      response: { status: 409, data: { message: 'A role with this name already exists' } },
    });
    const user = userEvent.setup();

    render(<CustomRolesTab />);
    await waitFor(() => expect(screen.getByText('Payroll Lead')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /add role/i }));
    await user.type(screen.getByLabelText(/name/i), 'Payroll Lead');
    await user.click(screen.getByLabelText('Manage organisation setup'));
    await user.click(screen.getByRole('button', { name: /^save$|^create$/i }));

    expect(
      await screen.findByText('A role with this name already exists'),
    ).toBeInTheDocument();
    // dialog stays open
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it('prefills the edit dialog and submits an update', async () => {
    mockGetResponses();
    mockedApi.updateRole.mockResolvedValue({ data: roles[0] } as any);
    const user = userEvent.setup();

    render(<CustomRolesTab />);
    await waitFor(() => expect(screen.getByText('Payroll Lead')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /edit/i }));

    expect(screen.getByDisplayValue('Payroll Lead')).toBeInTheDocument();
    expect(screen.getByLabelText('Manage organisation setup')).toBeChecked();

    await user.click(screen.getByRole('button', { name: /^save$|^update$/i }));

    await waitFor(() =>
      expect(mockedApi.updateRole).toHaveBeenCalledWith(
        'role-1',
        expect.objectContaining({ name: 'Payroll Lead' }),
      ),
    );
  });

  it('deletes a role after a confirm that names the user count', async () => {
    mockGetResponses();
    mockedApi.deleteRole.mockResolvedValue({} as any);
    const user = userEvent.setup();

    render(<CustomRolesTab />);
    await waitFor(() => expect(screen.getByText('Payroll Lead')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /delete/i }));

    const dialog = (await screen.findByText('Delete custom role')).closest('div')!.parentElement!;
    expect(within(dialog).getByText('3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm|yes, delete/i }));

    await waitFor(() => expect(mockedApi.deleteRole).toHaveBeenCalledWith('role-1'));
  });
});
