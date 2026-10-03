import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import ProjectDetailPage from './page';
import { projectsApi } from '@/lib/api-projects';
import { utilisationApi } from '@/lib/api-utilisation';
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

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
}));

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
  projectsApi: {
    get: jest.fn(),
    update: jest.fn(),
    listMembers: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    listTasks: jest.fn(),
    createTask: jest.fn(),
    updateTask: jest.fn(),
    deleteTask: jest.fn(),
  },
}));

jest.mock('@/lib/api-utilisation', () => ({
  utilisationApi: { get: jest.fn() },
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
const utilisation = utilisationApi as jest.Mocked<typeof utilisationApi>;
const employees = employeesApi as jest.Mocked<typeof employeesApi>;

const project = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  code: 'ACME',
  name: 'Acme rollout',
  clientName: 'Acme Corp',
  description: 'Roll out the thing',
  billable: true,
  status: 'ACTIVE',
  startDate: '2026-03-02',
  endDate: null,
  managerEmployeeId: 'e1',
  manager: { id: 'e1', name: 'Mia Lead' },
  memberCount: 1,
  taskCount: 1,
  canManage: true,
  ...over,
});

const member = {
  id: 'm1',
  employeeId: 'e2',
  role: 'Developer',
  startDate: '2026-03-02',
  endDate: null,
  employee: { id: 'e2', name: 'Ann Lee', code: 'E002' },
};

const task = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'Build API',
  description: null,
  billable: null,
  effectiveBillable: true,
  status: 'OPEN',
  estimateHours: 40,
  ...over,
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
  projects.get.mockResolvedValue({ data: project() } as any);
  projects.listMembers.mockResolvedValue({ data: [member] } as any);
  projects.listTasks.mockResolvedValue({ data: [task()] } as any);
  employees.getAll.mockResolvedValue({
    data: {
      data: [
        { id: 'e2', firstName: 'Ann', lastName: 'Lee', employeeCode: 'E002' },
        { id: 'e3', firstName: 'Bob', lastName: 'Ray', employeeCode: 'E003' },
      ],
    },
  } as any);
  utilisation.get.mockResolvedValue({
    data: {
      rows: [
        {
          employeeId: 'e2',
          name: 'Ann Lee',
          code: 'E002',
          department: null,
          capacityHours: 160,
          loggedHours: 120,
          billableHours: 100,
          utilisationPct: 75,
          billablePct: 62.5,
        },
      ],
      totals: {},
    },
  } as any);
});

const openTab = async (name: string) => {
  await screen.findByRole('tab', { name: 'Overview' });
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name }));
  });
};

describe('Project detail page', () => {
  it('renders the tabs and the overview', async () => {
    render(<ProjectDetailPage />);
    expect(await screen.findByText('Acme rollout')).toBeInTheDocument();
    for (const name of ['Overview', 'Members', 'Tasks', 'Hours']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Mia Lead')).toBeInTheDocument();
    expect(projects.get).toHaveBeenCalledWith('p1');
  });

  it('shows an error state when the project fails to load', async () => {
    projects.get.mockRejectedValue({ response: { status: 404 } });
    render(<ProjectDetailPage />);
    expect(await screen.findByText(/could not be loaded|not found/i)).toBeInTheDocument();
  });

  describe('Members tab', () => {
    it('lists members and offers "Add member" only when canManage', async () => {
      render(<ProjectDetailPage />);
      await openTab('Members');
      expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add member/i })).toBeInTheDocument();
    });

    it('hides add/remove for a plain member', async () => {
      asUser('EMPLOYEE', { id: 'e2' });
      projects.get.mockResolvedValue({ data: project({ canManage: false }) } as any);
      render(<ProjectDetailPage />);
      await openTab('Members');
      expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add member/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Remove Ann Lee/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Hours' })).not.toBeInTheDocument();
    });

    it('adds a member through the picker', async () => {
      projects.addMember.mockResolvedValue({ data: member } as any);
      render(<ProjectDetailPage />);
      await openTab('Members');
      fireEvent.click(await screen.findByRole('button', { name: /Add member/i }));
      await waitFor(() => expect(employees.getAll).toHaveBeenCalled());
      fireEvent.change(await screen.findByLabelText('Employee'), { target: { value: 'e3' } });
      fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'QA' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      await waitFor(() =>
        expect(projects.addMember).toHaveBeenCalledWith(
          'p1',
          expect.objectContaining({ employeeId: 'e3', role: 'QA' }),
        ),
      );
    });

    it('toasts "Membership ended" when removal only ended the membership', async () => {
      projects.removeMember.mockResolvedValue({ data: { ended: true } } as any);
      render(<ProjectDetailPage />);
      await openTab('Members');
      fireEvent.click(await screen.findByRole('button', { name: /Remove Ann Lee/i }));
      await waitFor(() => expect(projects.removeMember).toHaveBeenCalledWith('p1', 'm1'));
      await waitFor(() =>
        expect(mockToast.success).toHaveBeenCalledWith('Membership ended (hours already logged)'),
      );
    });

    it('toasts "Member removed" on a hard delete', async () => {
      projects.removeMember.mockResolvedValue({ data: { ended: false } } as any);
      render(<ProjectDetailPage />);
      await openTab('Members');
      fireEvent.click(await screen.findByRole('button', { name: /Remove Ann Lee/i }));
      await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Member removed'));
    });
  });

  describe('Tasks tab', () => {
    it('lists tasks and closing one toggles status', async () => {
      projects.updateTask.mockResolvedValue({ data: task({ status: 'CLOSED' }) } as any);
      render(<ProjectDetailPage />);
      await openTab('Tasks');
      expect(await screen.findByText('Build API')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /Close Build API/i }));
      await waitFor(() =>
        expect(projects.updateTask).toHaveBeenCalledWith('p1', 't1', { status: 'CLOSED' }),
      );
    });

    it('reopens a closed task', async () => {
      projects.listTasks.mockResolvedValue({ data: [task({ status: 'CLOSED' })] } as any);
      projects.updateTask.mockResolvedValue({ data: task() } as any);
      render(<ProjectDetailPage />);
      await openTab('Tasks');
      fireEvent.click(await screen.findByRole('button', { name: /Reopen Build API/i }));
      await waitFor(() =>
        expect(projects.updateTask).toHaveBeenCalledWith('p1', 't1', { status: 'OPEN' }),
      );
    });

    it('creates a task', async () => {
      projects.createTask.mockResolvedValue({ data: task({ id: 't2', name: 'QA' }) } as any);
      render(<ProjectDetailPage />);
      await openTab('Tasks');
      fireEvent.click(await screen.findByRole('button', { name: /Add task/i }));
      fireEvent.change(await screen.findByLabelText('Task name'), { target: { value: 'QA' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
      await waitFor(() =>
        expect(projects.createTask).toHaveBeenCalledWith('p1', expect.objectContaining({ name: 'QA' })),
      );
    });

    it('hides task controls from a plain member', async () => {
      asUser('EMPLOYEE', { id: 'e2' });
      projects.get.mockResolvedValue({ data: project({ canManage: false }) } as any);
      render(<ProjectDetailPage />);
      await openTab('Tasks');
      expect(await screen.findByText('Build API')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add task/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Close Build API/i })).not.toBeInTheDocument();
    });
  });

  describe('Hours tab', () => {
    it('loads utilisation by employee for this project', async () => {
      render(<ProjectDetailPage />);
      await openTab('Hours');
      expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
      expect(utilisation.get).toHaveBeenCalledWith(
        expect.objectContaining({
          groupBy: 'employee',
          projectId: 'p1',
          from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
      expect(screen.getByText('120')).toBeInTheDocument();
      expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('shows an error when the report fails', async () => {
      utilisation.get.mockRejectedValue(new Error('x'));
      render(<ProjectDetailPage />);
      await openTab('Hours');
      expect(await screen.findByText(/Failed to load hours/i)).toBeInTheDocument();
    });
  });
});
