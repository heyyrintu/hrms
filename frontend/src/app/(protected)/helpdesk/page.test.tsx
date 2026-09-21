import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import HelpdeskPage from './page';
import { helpdeskApi } from '@/lib/api-helpdesk';
import toast from 'react-hot-toast';

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

jest.mock('@/components/ui/Input', () => ({
  Input: ({ label, error, ...props }: any) => (
    <label>
      {label}
      <input aria-label={label} {...props} />
    </label>
  ),
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

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen }: any) => (isOpen ? <div role="dialog">{children}</div> : null),
  ModalFooter: ({ children }: any) => <div>{children}</div>,
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
      getMyTickets: jest.fn(),
      getCategories: jest.fn(),
      createTicket: jest.fn(),
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
  category: { id: 'cat-1', name: 'Payroll', code: 'PAY', slaHours: 48 },
  ...overrides,
});

describe('HelpdeskPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.getMyTickets.mockResolvedValue({ data: { data: [ticket()] } } as any);
    mockApi.getCategories.mockResolvedValue({
      data: [{ id: 'cat-1', name: 'Payroll', code: 'PAY', slaHours: 48, isActive: true }],
    } as any);
    mockApi.createTicket.mockResolvedValue({ data: { id: 'ticket-2' } } as any);
  });

  it('lists the tickets the employee raised', async () => {
    render(<HelpdeskPage />);

    expect(await screen.findByText(/#12 Payslip missing/)).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('links each ticket to its detail page', async () => {
    render(<HelpdeskPage />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/helpdesk/ticket-1');
  });

  it('flags a ticket past its SLA as overdue', async () => {
    mockApi.getMyTickets.mockResolvedValue({
      data: { data: [ticket({ slaDeadline: '2020-01-01T00:00:00.000Z' })] },
    } as any);

    render(<HelpdeskPage />);

    expect(await screen.findByText('Overdue')).toBeInTheDocument();
  });

  it('does not flag a resolved ticket as overdue even past the deadline', async () => {
    mockApi.getMyTickets.mockResolvedValue({
      data: {
        data: [
          ticket({ slaDeadline: '2020-01-01T00:00:00.000Z', status: 'RESOLVED' }),
        ],
      },
    } as any);

    render(<HelpdeskPage />);

    await screen.findByText(/#12 Payslip missing/);
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing has been raised', async () => {
    mockApi.getMyTickets.mockResolvedValue({ data: { data: [] } } as any);

    render(<HelpdeskPage />);

    expect(
      await screen.findByText('You have not raised any tickets yet.'),
    ).toBeInTheDocument();
  });

  it('raises a ticket from the form and reloads the list', async () => {
    render(<HelpdeskPage />);
    await screen.findByText(/#12 Payslip missing/);

    fireEvent.click(screen.getByText('New ticket'));

    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'cat-1' },
    });
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Laptop replacement' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Battery is dead' },
    });
    fireEvent.click(screen.getByText('Submit ticket'));

    await waitFor(() =>
      expect(mockApi.createTicket).toHaveBeenCalledWith({
        categoryId: 'cat-1',
        subject: 'Laptop replacement',
        description: 'Battery is dead',
        priority: 'MEDIUM',
      }),
    );
    await waitFor(() => expect(mockApi.getMyTickets).toHaveBeenCalledTimes(2));
  });

  it('refuses to submit an incomplete form', async () => {
    render(<HelpdeskPage />);
    await screen.findByText(/#12 Payslip missing/);

    fireEvent.click(screen.getByText('New ticket'));
    fireEvent.click(screen.getByText('Submit ticket'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Category, subject and description are required',
      ),
    );
    expect(mockApi.createTicket).not.toHaveBeenCalled();
  });
});
