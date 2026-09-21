import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FeedbackPage from './page';
import { feedbackApi } from '@/lib/api';

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

// Mock AuthContext -- a manager, so the Team tab is rendered.
const mockAuth = {
  user: {
    id: '1',
    email: 'manager@test.com',
    role: 'MANAGER',
    tenantId: 't1',
    employeeId: 'emp-mgr-1',
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

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

// Mock UI components
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

// Mock API
jest.mock('@/lib/api', () => ({
  feedbackApi: {
    give: jest.fn(),
    getReceived: jest.fn(),
    getSent: jest.fn(),
    getTeam: jest.fn(),
    getById: jest.fn(),
    delete: jest.fn(),
  },
  employeesApi: {
    getAll: jest.fn(),
  },
}));

// Mock utils
jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

const emptyPage = {
  data: { data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } },
};

const feedbackItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'fb-1',
  senderId: 'emp-2',
  receiverId: 'emp-mgr-1',
  content: 'Great handover on the payroll run',
  type: 'POSITIVE',
  visibility: 'PRIVATE',
  createdAt: '2026-02-11T12:00:00.000Z',
  sender: { id: 'emp-2', firstName: 'Asha', lastName: 'Rao' },
  receiver: { id: 'emp-mgr-1', firstName: 'Vikram', lastName: 'Singh' },
  ...overrides,
});

describe('FeedbackPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (feedbackApi.getReceived as jest.Mock).mockResolvedValue(emptyPage);
    (feedbackApi.getSent as jest.Mock).mockResolvedValue(emptyPage);
    (feedbackApi.getTeam as jest.Mock).mockResolvedValue(emptyPage);
  });

  it('renders the Continuous Feedback heading after loading', async () => {
    render(<FeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('Continuous Feedback')).toBeInTheDocument();
    });
  });

  it('loads received feedback on first render', async () => {
    render(<FeedbackPage />);

    await waitFor(() => {
      expect(feedbackApi.getReceived).toHaveBeenCalled();
    });
    expect(feedbackApi.getSent).not.toHaveBeenCalled();
    expect(feedbackApi.getTeam).not.toHaveBeenCalled();
  });

  it('renders the empty state when there is no feedback', async () => {
    render(<FeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('No Feedback')).toBeInTheDocument();
    });
    expect(
      screen.getByText('No one has shared feedback with you yet.'),
    ).toBeInTheDocument();
  });

  it('renders received feedback with its sender and content', async () => {
    (feedbackApi.getReceived as jest.Mock).mockResolvedValue({
      data: {
        data: [feedbackItem()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      },
    });

    render(<FeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('From Asha Rao')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Great handover on the payroll run'),
    ).toBeInTheDocument();
    expect(screen.getByText('Appreciation')).toBeInTheDocument();
  });

  it('switches to the Sent tab and loads sent feedback', async () => {
    render(<FeedbackPage />);

    await waitFor(() => {
      expect(feedbackApi.getReceived).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Sent'));

    await waitFor(() => {
      expect(feedbackApi.getSent).toHaveBeenCalled();
    });
  });

  it('switches to the Team tab and loads team feedback', async () => {
    render(<FeedbackPage />);

    await waitFor(() => {
      expect(feedbackApi.getReceived).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Team'));

    await waitFor(() => {
      expect(feedbackApi.getTeam).toHaveBeenCalled();
    });
  });

  /**
   * The team view shows feedback written about other people, so a plain
   * employee must not even be offered the tab -- the API would refuse it.
   */
  it('hides the Team tab from a plain employee', async () => {
    mockAuth.isManager = false;
    try {
      render(<FeedbackPage />);

      await waitFor(() => {
        expect(screen.getByText('Continuous Feedback')).toBeInTheDocument();
      });
      expect(screen.queryByText('Team')).not.toBeInTheDocument();
    } finally {
      mockAuth.isManager = true;
    }
  });

  it('only offers to delete feedback the signed-in user wrote', async () => {
    (feedbackApi.getReceived as jest.Mock).mockResolvedValue({
      data: {
        data: [feedbackItem()],
        meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
      },
    });

    render(<FeedbackPage />);

    await waitFor(() => {
      expect(screen.getByText('From Asha Rao')).toBeInTheDocument();
    });
    // Received from someone else, so there is nothing for this user to delete.
    expect(
      screen.queryByLabelText('Delete feedback'),
    ).not.toBeInTheDocument();
  });

  it('opens the give-feedback form and posts the entered feedback', async () => {
    const { employeesApi } = jest.requireMock('@/lib/api');
    employeesApi.getAll.mockResolvedValue({
      data: {
        data: [
          { id: 'emp-2', firstName: 'Asha', lastName: 'Rao', employeeCode: 'E002' },
        ],
      },
    });
    (feedbackApi.give as jest.Mock).mockResolvedValue({ data: { id: 'fb-9' } });

    render(<FeedbackPage />);

    await waitFor(() => {
      expect(feedbackApi.getReceived).toHaveBeenCalled();
    });

    fireEvent.click(screen.getAllByText('Give Feedback')[0]);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Asha Rao (E002)')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('Select employee'), {
      target: { value: 'emp-2' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('What went well, or what could go better...'),
      { target: { value: 'Thanks for covering the on-call weekend' } },
    );
    fireEvent.click(screen.getByText('Share'));

    await waitFor(() => {
      expect(feedbackApi.give).toHaveBeenCalledWith({
        receiverId: 'emp-2',
        content: 'Thanks for covering the on-call weekend',
        type: 'POSITIVE',
        visibility: 'PRIVATE',
      });
    });
  });
});
