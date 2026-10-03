import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ProjectsPage from './page';
import { projectsApi } from '@/lib/api-projects';
import { employeesApi } from '@/lib/api';

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

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let mockAuth: any;
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('@/lib/api-projects', () => ({
  projectsApi: { list: jest.fn(), create: jest.fn() },
}));

jest.mock('@/lib/api', () => ({
  employeesApi: { getAll: jest.fn() },
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (m: string) => mockToast.success(m),
    error: (m: string) => mockToast.error(m),
  },
}));

const projects = projectsApi as jest.Mocked<typeof projectsApi>;
const employees = employeesApi as jest.Mocked<typeof employeesApi>;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  code: 'ACME',
  name: 'Acme rollout',
  clientName: 'Acme Corp',
  description: null,
  billable: true,
  status: 'ACTIVE',
  startDate: '2026-03-02',
  endDate: null,
  managerEmployeeId: 'e1',
  manager: { id: 'e1', name: 'Mia Lead' },
  memberCount: 3,
  taskCount: 2,
  canManage: true,
  ...over,
});

const page = (data: unknown[]) => ({
  data: { data, meta: { total: data.length, page: 1, limit: 20, totalPages: 1 } },
});

const asUser = (role: string, employee?: { id: string }) => {
  mockAuth = {
    user: { id: 'u1', role, employee },
    hasRole: (...roles: string[]) => roles.includes(role),
    hasPermission: () => false,
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  asUser('HR_ADMIN');
  projects.list.mockResolvedValue(page([row(), row({ id: 'p2', code: 'INT', name: 'Internal', status: 'ON_HOLD' })]) as any);
  employees.getAll.mockResolvedValue({
    data: { data: [{ id: 'e1', firstName: 'Mia', lastName: 'Lead', employeeCode: 'E001' }] },
  } as any);
});

describe('Projects list page', () => {
  it('renders rows from projectsApi.list', async () => {
    render(<ProjectsPage />);
    expect(await screen.findByText('Acme rollout')).toBeInTheDocument();
    expect(screen.getByText('Internal')).toBeInTheDocument();
    expect(screen.getAllByText('Mia Lead')).toHaveLength(2);
    expect(screen.getByRole('link', { name: /Acme rollout/ })).toHaveAttribute('href', '/projects/p1');
    expect(projects.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });

  it('shows an empty state', async () => {
    projects.list.mockResolvedValue(page([]) as any);
    render(<ProjectsPage />);
    expect(await screen.findByText(/No projects/i)).toBeInTheDocument();
  });

  it('shows an error state and toasts when loading fails', async () => {
    projects.list.mockRejectedValue(new Error('boom'));
    render(<ProjectsPage />);
    expect(await screen.findByText(/Failed to load projects/i)).toBeInTheDocument();
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('passes search and status filters to the API', async () => {
    render(<ProjectsPage />);
    await screen.findByText('Acme rollout');
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ACTIVE' } });
    await waitFor(() =>
      expect(projects.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'acme', status: 'ACTIVE', page: 1 }),
      ),
    );
  });

  it('shows "New project" to an HR admin', async () => {
    render(<ProjectsPage />);
    await screen.findByText('Acme rollout');
    expect(screen.getByRole('button', { name: /New project/i })).toBeInTheDocument();
  });

  it('hides "New project" from an employee', async () => {
    asUser('EMPLOYEE', { id: 'emp-1' });
    render(<ProjectsPage />);
    await screen.findByText('Acme rollout');
    expect(screen.queryByRole('button', { name: /New project/i })).not.toBeInTheDocument();
  });

  it('the create modal posts an uppercased code', async () => {
    projects.create.mockResolvedValue({ data: row({ id: 'new' }) } as any);
    render(<ProjectsPage />);
    await screen.findByText('Acme rollout');
    fireEvent.click(screen.getByRole('button', { name: /New project/i }));

    await screen.findByRole('heading', { name: 'New project' });
    const dialog = screen;
    fireEvent.change(dialog.getByLabelText('Code'), { target: { value: 'beta-2' } });
    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Beta' } });
    fireEvent.click(dialog.getByRole('button', { name: /Create project/i }));

    await waitFor(() =>
      expect(projects.create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'BETA-2', name: 'Beta' }),
      ),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });

  it('rejects an invalid code client-side', async () => {
    render(<ProjectsPage />);
    await screen.findByText('Acme rollout');
    fireEvent.click(screen.getByRole('button', { name: /New project/i }));
    await screen.findByRole('heading', { name: 'New project' });
    const dialog = screen;
    fireEvent.change(dialog.getByLabelText('Code'), { target: { value: 'a b' } });
    fireEvent.change(dialog.getByLabelText('Name'), { target: { value: 'Beta' } });
    fireEvent.click(dialog.getByRole('button', { name: /Create project/i }));
    expect(await dialog.findByText(/2-20 characters/i)).toBeInTheDocument();
    expect(projects.create).not.toHaveBeenCalled();
  });
});
