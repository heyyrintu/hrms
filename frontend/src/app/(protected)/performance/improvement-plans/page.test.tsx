import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import ImprovementPlansPage from './page';
import { improvementPlansApi, employeesApi } from '@/lib/api';
import toast from 'react-hot-toast';

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

// Mock AuthContext -- by default a manager who owns the plans below. Tests that
// need HR swap `mockAuth` before rendering.
const managerAuth = {
  user: {
    id: 'u1',
    email: 'manager@test.com',
    role: 'MANAGER',
    tenantId: 't1',
    employeeId: 'emp-manager',
  },
  isAuthenticated: true,
  isLoading: false,
  isManager: true,
  isAdmin: false,
  isSuperAdmin: false,
  hasRole: jest.fn().mockReturnValue(true),
  login: jest.fn(),
  logout: jest.fn(),
};

// An HR admin account with no employee profile -- the case the owner picker exists for.
const hrNoProfileAuth = {
  ...managerAuth,
  user: { id: 'u-hr', email: 'hr@test.com', role: 'HR_ADMIN', tenantId: 't1', employeeId: undefined },
  isManager: false,
  isAdmin: true,
};

let mockAuth: typeof managerAuth | typeof hrNoProfileAuth = managerAuth;

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

const emptyPage = {
  data: { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 0 } },
};

jest.mock('@/lib/api', () => ({
  improvementPlansApi: {
    create: jest.fn(),
    getAll: jest.fn(),
    getMine: jest.fn(),
    getTeam: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    addGoal: jest.fn(),
    updateGoal: jest.fn(),
    deleteGoal: jest.fn(),
  },
  employeesApi: {
    getAll: jest.fn(),
  },
}));

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

const api = improvementPlansApi as jest.Mocked<typeof improvementPlansApi>;

const planRow = {
  id: 'pip-1',
  title: 'Improve delivery consistency',
  description: 'Three months of focused work',
  startDate: '2025-03-01T12:00:00Z',
  endDate: '2025-06-01T12:00:00Z',
  status: 'ACTIVE',
  employee: {
    id: 'emp-employee',
    firstName: 'Asha',
    lastName: 'Rao',
    department: { name: 'Engineering' },
  },
  manager: { id: 'emp-manager', firstName: 'Ravi', lastName: 'Kumar' },
  goals: [
    {
      id: 'goal-1',
      planId: 'pip-1',
      description: 'Ship weekly',
      targetDate: '2025-04-01T12:00:00Z',
      isCompleted: false,
      completedAt: null,
      notes: null,
    },
  ],
};

const listResponse = {
  data: { data: [planRow], meta: { total: 1, page: 1, limit: 20, totalPages: 1 } },
};

describe('ImprovementPlansPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth = managerAuth;
    (employeesApi.getAll as jest.Mock).mockResolvedValue({
      data: {
        data: [
          { id: 'emp-employee', firstName: 'Asha', lastName: 'Rao', employeeCode: 'E1' },
          { id: 'emp-manager', firstName: 'Ravi', lastName: 'Kumar', employeeCode: 'M1' },
          { id: 'emp-lead', firstName: 'Lina', lastName: 'Das', employeeCode: 'L1' },
        ],
      },
    });
    api.create.mockResolvedValue({ data: { id: 'pip-new' } } as any);
    api.getTeam.mockResolvedValue(listResponse as any);
    api.getMine.mockResolvedValue(emptyPage as any);
    api.getAll.mockResolvedValue(emptyPage as any);
    api.getById.mockResolvedValue({ data: planRow } as any);
    api.updateGoal.mockResolvedValue({ data: {} } as any);
  });

  it('renders the heading after loading', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Improvement Plans')).toBeInTheDocument();
    });
  });

  it('renders the subtitle', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() => {
      expect(
        screen.getByText('Track performance improvement plans and their goals'),
      ).toBeInTheDocument();
    });
  });

  it('defaults a manager to the team tab and loads team plans', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() => {
      expect(api.getTeam).toHaveBeenCalled();
    });
    expect(api.getAll).not.toHaveBeenCalled();
  });

  it('shows the loaded plan in the table', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('Improve delivery consistency')).toBeInTheDocument();
    });
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
  });

  it('offers the New Plan button to a manager', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('New Plan')).toBeInTheDocument();
    });
  });

  it('switches to My Plans and calls the /me endpoint', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() => expect(api.getTeam).toHaveBeenCalled());

    fireEvent.click(screen.getByText('My Plans'));

    await waitFor(() => {
      expect(api.getMine).toHaveBeenCalled();
    });
  });

  it('shows an empty state when there are no plans', async () => {
    api.getTeam.mockResolvedValue(emptyPage as any);

    render(<ImprovementPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('No improvement plans')).toBeInTheDocument();
    });
  });

  it('opens the detail modal with the plan goals', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() =>
      expect(screen.getByText('Improve delivery consistency')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText('View Improve delivery consistency'));

    await waitFor(() => {
      expect(api.getById).toHaveBeenCalledWith('pip-1');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    expect(screen.getByText('Ship weekly')).toBeInTheDocument();
  });

  it('ticks a goal off through the goal endpoint', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() =>
      expect(screen.getByText('Improve delivery consistency')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText('View Improve delivery consistency'));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Complete Ship weekly'));

    await waitFor(() => {
      expect(api.updateGoal).toHaveBeenCalledWith('pip-1', 'goal-1', {
        isCompleted: true,
      });
    });
  });

  it('saves a goal note', async () => {
    render(<ImprovementPlansPage />);

    await waitFor(() =>
      expect(screen.getByText('Improve delivery consistency')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText('View Improve delivery consistency'));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Notes for Ship weekly'), {
      target: { value: 'Shipped four weeks running' },
    });
    fireEvent.click(screen.getByText('Save Note'));

    await waitFor(() => {
      expect(api.updateGoal).toHaveBeenCalledWith('pip-1', 'goal-1', {
        notes: 'Shipped four weeks running',
      });
    });
  });

  describe('plan owner', () => {
    /** Opens the create modal and fills every required field. */
    const fillCreateForm = async () => {
      await waitFor(() => expect(screen.getByText('New Plan')).toBeInTheDocument());
      fireEvent.click(screen.getByText('New Plan'));
      await waitFor(() =>
        expect(screen.getAllByRole('option', { name: 'Asha Rao (E1)' }).length).toBeGreaterThan(0),
      );

      fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'emp-employee' } });
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Improve delivery' } });
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Focus' } });
      fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2025-03-01' } });
      fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2025-06-01' } });
    };

    it('is not offered to a manager, who always owns the plans they raise', async () => {
      render(<ImprovementPlansPage />);
      await fillCreateForm();

      expect(screen.queryByLabelText('Plan owner')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Create Plan'));
      await waitFor(() => expect(api.create).toHaveBeenCalled());
      expect(api.create.mock.calls[0][0].managerId).toBeUndefined();
    });

    it('lets HR pick an owner, and never offers the employee as their own owner', async () => {
      mockAuth = hrNoProfileAuth;
      api.getAll.mockResolvedValue(emptyPage as any);

      render(<ImprovementPlansPage />);
      await fillCreateForm();

      const picker = screen.getByLabelText('Plan owner');
      const ownerOptions = Array.from((picker as HTMLSelectElement).options).map((o) => o.value);
      expect(ownerOptions).toEqual(['', 'emp-manager', 'emp-lead']);
      expect(screen.getByRole('option', { name: "Default (employee's reporting manager)" })).toBeInTheDocument();

      fireEvent.change(picker, { target: { value: 'emp-lead' } });
      fireEvent.click(screen.getByText('Create Plan'));

      await waitFor(() => {
        expect(api.create).toHaveBeenCalledWith(
          expect.objectContaining({ employeeId: 'emp-employee', managerId: 'emp-lead' }),
        );
      });
    });

    it('leaves the owner to the server when HR keeps the default', async () => {
      mockAuth = hrNoProfileAuth;
      api.getAll.mockResolvedValue(emptyPage as any);

      render(<ImprovementPlansPage />);
      await fillCreateForm();
      fireEvent.click(screen.getByText('Create Plan'));

      await waitFor(() => expect(api.create).toHaveBeenCalled());
      expect(api.create.mock.calls[0][0].managerId).toBeUndefined();
    });

    it("shows the server's reason when no owner can be resolved", async () => {
      mockAuth = hrNoProfileAuth;
      api.getAll.mockResolvedValue(emptyPage as any);
      const reason =
        'Pick a plan owner: this employee has no reporting manager and your account has no employee profile';
      api.create.mockRejectedValue({ response: { status: 400, data: { message: reason } } });

      render(<ImprovementPlansPage />);
      await fillCreateForm();
      fireEvent.click(screen.getByText('Create Plan'));

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(reason));
    });
  });

  it('shows an error toast when loading fails', async () => {
    api.getTeam.mockRejectedValue(new Error('boom'));

    render(<ImprovementPlansPage />);

    await waitFor(() => {
      expect(screen.getByText('No improvement plans')).toBeInTheDocument();
    });
  });
});
