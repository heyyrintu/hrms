import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminHelpdeskPage from './page';
import { helpdeskApi } from '@/lib/api-helpdesk';

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
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
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

jest.mock('@/components/ui/Select', () => ({
  Select: ({ label, options = [], placeholder, ...props }: any) => (
    <label>
      {label}
      <select aria-label={label} {...props}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/api-helpdesk', () => {
  const actual = jest.requireActual('@/lib/api-helpdesk');
  return {
    ...actual,
    helpdeskApi: {
      getTickets: jest.fn(),
      getCategories: jest.fn(),
      getAgents: jest.fn(),
      getStats: jest.fn(),
      assign: jest.fn(),
    },
  };
});

const mockApi = helpdeskApi as jest.Mocked<typeof helpdeskApi>;

const ticket = (overrides: Record<string, unknown> = {}) => ({
  id: 'ticket-1',
  ticketNumber: 12,
  subject: 'Payslip missing',
  description: 'No March payslip',
  priority: 'HIGH',
  status: 'OPEN',
  categoryId: 'cat-1',
  employeeId: 'emp-1',
  assignedToId: null,
  slaDeadline: '2999-01-01T00:00:00.000Z',
  createdAt: '2026-03-15T12:00:00.000Z',
  employee: { id: 'emp-1', firstName: 'Asha', lastName: 'Rao' },
  category: { id: 'cat-1', name: 'Payroll', code: 'PAY', slaHours: 48 },
  ...overrides,
});

describe('AdminHelpdeskPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getTickets.mockResolvedValue({ data: { data: [ticket()] } } as any);
    mockApi.getCategories.mockResolvedValue({
      data: [{ id: 'cat-1', name: 'Payroll', code: 'PAY', slaHours: 48, isActive: true }],
    } as any);
    mockApi.getAgents.mockResolvedValue({
      data: [{ id: 'user-hr', email: 'hr@test.com', employeeId: 'emp-hr', name: 'Nina Shah' }],
    } as any);
    mockApi.getStats.mockResolvedValue({
      data: {
        byStatus: {
          OPEN: 2,
          IN_PROGRESS: 1,
          WAITING_ON_EMPLOYEE: 0,
          RESOLVED: 4,
          CLOSED: 9,
        },
        overdue: 3,
        avgResolutionHours: 5.5,
      },
    } as any);
    mockApi.assign.mockResolvedValue({ data: {} } as any);
  });

  it('shows the queue with the raiser', async () => {
    render(<AdminHelpdeskPage />);

    expect(await screen.findByText(/#12 Payslip missing/)).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
  });

  it('renders the stats strip', async () => {
    render(<AdminHelpdeskPage />);

    await screen.findByTestId('stat-OPEN');
    expect(screen.getByTestId('stat-OPEN')).toHaveTextContent('Open: 2');
    expect(screen.getByTestId('stat-overdue')).toHaveTextContent('Overdue: 3');
    expect(screen.getByTestId('stat-avg')).toHaveTextContent('5.5h');
  });

  it('shows n/a when nothing has been resolved yet', async () => {
    mockApi.getStats.mockResolvedValue({
      data: {
        byStatus: {
          OPEN: 0,
          IN_PROGRESS: 0,
          WAITING_ON_EMPLOYEE: 0,
          RESOLVED: 0,
          CLOSED: 0,
        },
        overdue: 0,
        avgResolutionHours: null,
      },
    } as any);

    render(<AdminHelpdeskPage />);

    await waitFor(() =>
      expect(screen.getByTestId('stat-avg')).toHaveTextContent('n/a'),
    );
  });

  it('refetches with the status filter applied', async () => {
    render(<AdminHelpdeskPage />);
    await screen.findByText(/#12 Payslip missing/);

    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'IN_PROGRESS' },
    });

    await waitFor(() =>
      expect(mockApi.getTickets).toHaveBeenLastCalledWith({
        status: 'IN_PROGRESS',
        categoryId: undefined,
        overdue: undefined,
      }),
    );
  });

  it('refetches with the overdue filter applied', async () => {
    render(<AdminHelpdeskPage />);
    await screen.findByText(/#12 Payslip missing/);

    fireEvent.click(screen.getByLabelText('Overdue only'));

    await waitFor(() =>
      expect(mockApi.getTickets).toHaveBeenLastCalledWith({
        status: undefined,
        categoryId: undefined,
        overdue: true,
      }),
    );
  });

  it('assigns a ticket to an agent by user id', async () => {
    render(<AdminHelpdeskPage />);
    await screen.findByText(/#12 Payslip missing/);

    fireEvent.change(await screen.findByLabelText('Assign #12'), {
      target: { value: 'user-hr' },
    });

    await waitFor(() =>
      expect(mockApi.assign).toHaveBeenCalledWith('ticket-1', 'user-hr'),
    );
  });

  it('shows an empty queue message', async () => {
    mockApi.getTickets.mockResolvedValue({ data: { data: [] } } as any);

    render(<AdminHelpdeskPage />);

    expect(await screen.findByText('Nothing in the queue.')).toBeInTheDocument();
  });
});
