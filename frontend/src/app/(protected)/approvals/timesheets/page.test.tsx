import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import TimesheetApprovalsPage from './page';
import { timesheetsApi } from '@/lib/api-timesheets';

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

jest.mock('@/lib/api-timesheets', () => ({
  timesheetsApi: {
    getPendingApprovals: jest.fn(),
    get: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  },
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (m: string) => mockToast.success(m),
    error: (m: string) => mockToast.error(m),
  },
}));

const api = timesheetsApi as jest.Mocked<typeof timesheetsApi>;

const pending = [
  {
    id: 'ts-1',
    employeeId: 'emp-1',
    weekStart: '2026-03-16',
    status: 'SUBMITTED' as const,
    totalHours: 38.5,
    submittedAt: '2026-03-20T10:00:00.000Z',
    decidedAt: null,
    approverNote: null,
    employee: { id: 'emp-1', name: 'Asha Rao', code: 'E001' },
  },
];

const detail = {
  ...pending[0],
  entries: [
    {
      id: 'e1',
      date: '2026-03-16',
      projectId: 'p1',
      taskId: 't1',
      hours: 7.5,
      billable: true,
      note: null,
      project: { id: 'p1', code: 'ALPHA', name: 'Alpha' },
      task: { id: 't1', name: 'Build' },
    },
    {
      id: 'e2',
      date: '2026-03-17',
      projectId: 'p1',
      taskId: 't1',
      hours: 8,
      billable: true,
      note: null,
      project: { id: 'p1', code: 'ALPHA', name: 'Alpha' },
      task: { id: 't1', name: 'Build' },
    },
    {
      id: 'e3',
      date: '2026-03-17',
      projectId: 'p2',
      taskId: null,
      hours: 1,
      billable: false,
      note: null,
      project: { id: 'p2', code: 'BETA', name: 'Beta' },
      task: null,
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getPendingApprovals.mockResolvedValue({ data: pending } as any);
  api.get.mockResolvedValue({ data: detail } as any);
  api.approve.mockResolvedValue({ data: {} } as any);
  api.reject.mockResolvedValue({ data: {} } as any);
});

const openDetail = async () => {
  render(<TimesheetApprovalsPage />);
  fireEvent.click(await screen.findByRole('button', { name: /review asha rao/i }));
  return screen.findByRole('dialog');
};

describe('Timesheet approvals page', () => {
  it('lists the pending timesheets', async () => {
    render(<TimesheetApprovalsPage />);
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('16 Mar 2026')).toBeInTheDocument();
    expect(screen.getByText('38.5')).toBeInTheDocument();
    expect(api.getPendingApprovals).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when nothing is waiting', async () => {
    api.getPendingApprovals.mockResolvedValue({ data: [] } as any);
    render(<TimesheetApprovalsPage />);
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry', async () => {
    api.getPendingApprovals.mockRejectedValueOnce(new Error('boom'));
    render(<TimesheetApprovalsPage />);
    expect(await screen.findByText(/failed to load/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  });

  it('opens the day by project breakdown', async () => {
    const dialog = await openDetail();
    expect(api.get).toHaveBeenCalledWith('ts-1');

    expect(await within(dialog).findByText('ALPHA / Build')).toBeInTheDocument();
    expect(within(dialog).getByText('BETA')).toBeInTheDocument();
    // Column headers for the whole week.
    expect(within(dialog).getByText('Mon 16')).toBeInTheDocument();
    expect(within(dialog).getByText('Sun 22')).toBeInTheDocument();
    // Cells and totals.
    expect(within(dialog).getByTestId('cell-p1|t1-2026-03-16')).toHaveTextContent('7.5');
    expect(within(dialog).getByTestId('cell-p2|-2026-03-17')).toHaveTextContent('1');
    expect(within(dialog).getByTestId('row-total-p1|t1')).toHaveTextContent('15.5');
    expect(within(dialog).getByTestId('col-total-2026-03-17')).toHaveTextContent('9');
    expect(within(dialog).getByTestId('grand-total')).toHaveTextContent('16.5');
  });

  it('approves with the note and refreshes the list', async () => {
    const dialog = await openDetail();
    await within(dialog).findByText('ALPHA / Build');

    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'looks good' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^approve/i }));

    await waitFor(() => expect(api.approve).toHaveBeenCalledWith('ts-1', 'looks good'));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    await waitFor(() => expect(api.getPendingApprovals).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects with the note', async () => {
    const dialog = await openDetail();
    await within(dialog).findByText('ALPHA / Build');

    fireEvent.change(within(dialog).getByLabelText('Note'), { target: { value: 'split by task' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^reject/i }));

    await waitFor(() => expect(api.reject).toHaveBeenCalledWith('ts-1', 'split by task'));
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('sends no note when the field is blank', async () => {
    const dialog = await openDetail();
    await within(dialog).findByText('ALPHA / Build');
    fireEvent.click(within(dialog).getByRole('button', { name: /^approve/i }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith('ts-1', undefined));
  });

  it('keeps the dialog open and shows the server message when the decision fails', async () => {
    api.approve.mockRejectedValue({ response: { data: { message: 'Already processed' } } });
    const dialog = await openDetail();
    await within(dialog).findByText('ALPHA / Build');
    fireEvent.click(within(dialog).getByRole('button', { name: /^approve/i }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Already processed'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes the dialog and reports when the detail cannot be loaded', async () => {
    api.get.mockRejectedValue(new Error('404'));
    render(<TimesheetApprovalsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /review asha rao/i }));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
