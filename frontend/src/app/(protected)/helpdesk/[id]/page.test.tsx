import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import HelpdeskTicketPage from './page';
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

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ticket-1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

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

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/api-helpdesk', () => {
  const actual = jest.requireActual('@/lib/api-helpdesk');
  return {
    ...actual,
    helpdeskApi: {
      getTicket: jest.fn(),
      changeStatus: jest.fn(),
      addComment: jest.fn(),
    },
  };
});

const mockApi = helpdeskApi as jest.Mocked<typeof helpdeskApi>;

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: 'ticket-1',
  ticketNumber: 12,
  subject: 'Payslip missing',
  description: 'No March payslip',
  priority: 'HIGH',
  status: 'RESOLVED',
  categoryId: 'cat-1',
  employeeId: 'emp-1',
  assignedToId: 'user-agent',
  slaDeadline: '2999-01-01T00:00:00.000Z',
  resolvedAt: '2026-03-16T12:00:00.000Z',
  createdAt: '2026-03-15T12:00:00.000Z',
  employee: { id: 'emp-1', firstName: 'Asha', lastName: 'Rao' },
  category: { id: 'cat-1', name: 'Payroll', code: 'PAY', slaHours: 48 },
  assignedTo: { id: 'user-agent', email: 'agent@test.com', employeeId: 'emp-agent' },
  actor: 'OWNER',
  allowedStatuses: ['CLOSED', 'IN_PROGRESS'],
  comments: [
    {
      id: 'c-1',
      content: 'Looking into it',
      isInternal: false,
      authorId: 'user-agent',
      createdAt: '2026-03-15T13:00:00.000Z',
      author: { id: 'user-agent', email: 'agent@test.com' },
    },
  ],
  ...overrides,
});

describe('HelpdeskTicketPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getTicket.mockResolvedValue({ data: detail() } as any);
    mockApi.changeStatus.mockResolvedValue({ data: {} } as any);
    mockApi.addComment.mockResolvedValue({ data: {} } as any);
  });

  it('renders the ticket and its comment thread', async () => {
    render(<HelpdeskTicketPage />);

    expect(await screen.findByText(/#12 Payslip missing/)).toBeInTheDocument();
    expect(screen.getByText('No March payslip')).toBeInTheDocument();
    expect(screen.getByText('Looking into it')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
  });

  it('offers exactly the statuses the API says the actor may pick', async () => {
    render(<HelpdeskTicketPage />);

    expect(await screen.findByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.queryByText('Waiting on you')).not.toBeInTheDocument();
  });

  it('offers the owner the un-park action on a ticket waiting on them', async () => {
    mockApi.getTicket.mockResolvedValue({
      data: detail({
        status: 'WAITING_ON_EMPLOYEE',
        actor: 'OWNER',
        allowedStatuses: ['IN_PROGRESS'],
      }),
    } as any);

    render(<HelpdeskTicketPage />);

    fireEvent.click(await screen.findByText('In progress'));

    await waitFor(() =>
      expect(mockApi.changeStatus).toHaveBeenCalledWith('ticket-1', 'IN_PROGRESS'),
    );
  });

  it('reloads after a comment, so an un-parked status is picked up', async () => {
    mockApi.getTicket.mockResolvedValue({
      data: detail({
        status: 'WAITING_ON_EMPLOYEE',
        actor: 'OWNER',
        allowedStatuses: ['IN_PROGRESS'],
      }),
    } as any);

    render(<HelpdeskTicketPage />);
    await screen.findByText(/#12 Payslip missing/);

    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'Here is the document' },
    });
    fireEvent.click(screen.getByText('Post comment'));

    await waitFor(() =>
      expect(mockApi.addComment).toHaveBeenCalledWith(
        'ticket-1',
        'Here is the document',
        false,
      ),
    );
    await waitFor(() => expect(mockApi.getTicket).toHaveBeenCalledTimes(2));
  });

  it('offers no status buttons when the actor may do nothing', async () => {
    mockApi.getTicket.mockResolvedValue({
      data: detail({ status: 'OPEN', allowedStatuses: [] }),
    } as any);

    render(<HelpdeskTicketPage />);

    await screen.findByText(/#12 Payslip missing/);
    expect(screen.queryByText('Move this ticket')).not.toBeInTheDocument();
  });

  it('posts a status change and reloads', async () => {
    render(<HelpdeskTicketPage />);

    fireEvent.click(await screen.findByText('Closed'));

    await waitFor(() =>
      expect(mockApi.changeStatus).toHaveBeenCalledWith('ticket-1', 'CLOSED'),
    );
    await waitFor(() => expect(mockApi.getTicket).toHaveBeenCalledTimes(2));
  });

  it('hides the internal-note checkbox from the ticket owner', async () => {
    render(<HelpdeskTicketPage />);

    await screen.findByText(/#12 Payslip missing/);
    expect(screen.queryByLabelText('Internal note')).not.toBeInTheDocument();
  });

  it('offers the internal-note checkbox to HR and marks internal comments', async () => {
    mockApi.getTicket.mockResolvedValue({
      data: detail({
        actor: 'HR',
        comments: [
          {
            id: 'c-1',
            content: 'Looking into it',
            isInternal: false,
            authorId: 'user-agent',
            createdAt: '2026-03-15T13:00:00.000Z',
            author: { id: 'user-agent', email: 'agent@test.com' },
          },
          {
            id: 'c-2',
            content: 'Check the payroll run',
            isInternal: true,
            authorId: 'user-hr',
            createdAt: '2026-03-15T14:00:00.000Z',
            author: { id: 'user-hr', email: 'hr@test.com' },
          },
        ],
      }),
    } as any);

    render(<HelpdeskTicketPage />);

    expect(await screen.findByLabelText('Internal note')).toBeInTheDocument();
    expect(screen.getByText('Check the payroll run')).toBeInTheDocument();
    expect(screen.getAllByTestId('internal-comment')).toHaveLength(1);
  });

  it('posts a comment with the internal flag the user chose', async () => {
    mockApi.getTicket.mockResolvedValue({ data: detail({ actor: 'HR' }) } as any);

    render(<HelpdeskTicketPage />);
    await screen.findByText(/#12 Payslip missing/);

    fireEvent.change(screen.getByLabelText('Add a comment'), {
      target: { value: 'Escalated to payroll' },
    });
    fireEvent.click(screen.getByLabelText('Internal note'));
    fireEvent.click(screen.getByText('Post comment'));

    await waitFor(() =>
      expect(mockApi.addComment).toHaveBeenCalledWith(
        'ticket-1',
        'Escalated to payroll',
        true,
      ),
    );
  });

  it('does not post an empty comment', async () => {
    render(<HelpdeskTicketPage />);
    await screen.findByText(/#12 Payslip missing/);

    fireEvent.click(screen.getByText('Post comment'));

    await waitFor(() => expect(mockApi.addComment).not.toHaveBeenCalled());
  });
});
