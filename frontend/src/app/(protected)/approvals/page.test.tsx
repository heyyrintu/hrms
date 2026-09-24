import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import toast from 'react-hot-toast';
import MyApprovalsPage from './page';

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

jest.mock('@/lib/api-workflow', () => {
  const actual = jest.requireActual('@/lib/api-workflow');
  return {
    ...actual,
    workflowApi: {
      getInbox: jest.fn(),
      getTrail: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { workflowApi } = require('@/lib/api-workflow');

const leaveItem = {
  instanceId: 'inst-1',
  entityType: 'LEAVE',
  entityId: 'leave-1',
  title: 'Casual Leave · 3 days',
  subtitle: '12 Oct – 14 Oct 2026',
  requesterName: 'Asha Rao',
  link: '/approvals/leave',
  submittedAt: '2026-10-01T12:00:00Z',
  currentStepOrder: 1,
  totalSteps: 2,
  currentStepName: 'Reporting manager',
  onBehalfOf: null,
};

const expenseItem = {
  instanceId: 'inst-2',
  entityType: 'EXPENSE',
  entityId: 'exp-1',
  title: 'Travel · ₹12,000',
  subtitle: null,
  requesterName: 'Vikram Shah',
  link: '/approvals/expenses',
  submittedAt: '2026-10-02T12:00:00Z',
  currentStepOrder: 2,
  totalSteps: 2,
  currentStepName: 'Finance',
  onBehalfOf: { userId: 'u-boss', name: 'Meera Iyer' },
};

const payrollItem = {
  instanceId: 'inst-3',
  entityType: 'PAYROLL_RUN',
  entityId: 'run-1',
  title: 'March 2026 payroll',
  subtitle: '42 employees',
  requesterName: null,
  link: '/payroll',
  submittedAt: '2026-10-03T12:00:00Z',
  currentStepOrder: 1,
  totalSteps: 1,
  currentStepName: 'HR approval',
  onBehalfOf: null,
};

const loanItem = {
  instanceId: 'inst-4',
  entityType: 'LOAN',
  entityId: 'loan-1',
  title: 'Personal loan · ₹50,000',
  subtitle: null,
  requesterName: 'Asha Rao',
  link: '/approvals/loans',
  submittedAt: '2026-10-04T12:00:00Z',
  currentStepOrder: 1,
  totalSteps: 1,
  currentStepName: 'HR approval',
  onBehalfOf: null,
};

const trail = {
  instanceId: 'inst-1',
  status: 'PENDING',
  round: 1,
  currentStepOrder: 1,
  canAct: true,
  steps: [
    {
      order: 1,
      name: 'Reporting manager',
      approverType: 'REPORTING_MANAGER',
      state: 'PENDING',
      actedBy: null,
      onBehalfOf: null,
      isOverride: false,
      actedAt: null,
      note: null,
    },
    {
      order: 2,
      name: 'HR review',
      approverType: 'HR_ADMIN',
      state: 'WAITING',
      actedBy: null,
      onBehalfOf: null,
      isOverride: false,
      actedAt: null,
      note: null,
    },
  ],
};

describe('MyApprovalsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    workflowApi.getInbox.mockResolvedValue({ data: { items: [leaveItem, expenseItem] } });
    workflowApi.getTrail.mockResolvedValue({ data: trail });
    workflowApi.approve.mockResolvedValue({ data: {} });
    workflowApi.reject.mockResolvedValue({ data: {} });
  });

  it('renders every inbox item with its step and link', async () => {
    render(<MyApprovalsPage />);

    expect(await screen.findByText('Casual Leave · 3 days')).toBeInTheDocument();
    expect(screen.getByText('Travel · ₹12,000')).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 2: Reporting manager/)).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 2: Finance/)).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Open/ });
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/approvals/leave',
      '/approvals/expenses',
    ]);
  });

  it('shows an "on behalf of" badge for delegated items', async () => {
    render(<MyApprovalsPage />);
    expect(await screen.findByText('On behalf of Meera Iyer')).toBeInTheDocument();
  });

  it('counts items per type on the filter chips and filters by type', async () => {
    render(<MyApprovalsPage />);
    await screen.findByText('Casual Leave · 3 days');

    const group = screen.getByRole('group', { name: 'Filter by type' });
    const allChip = within(group).getByRole('button', { name: /All/ });
    expect(allChip).toHaveTextContent('2');
    const expenseChip = within(group).getByRole('button', { name: /Expense/ });
    expect(expenseChip).toHaveTextContent('1');
    expect(within(group).getByRole('button', { name: /Loan/ })).toHaveTextContent('0');

    fireEvent.click(expenseChip);
    expect(screen.queryByText('Casual Leave · 3 days')).not.toBeInTheDocument();
    expect(screen.getByText('Travel · ₹12,000')).toBeInTheDocument();
  });

  it('approves with a note, then refreshes the inbox', async () => {
    render(<MyApprovalsPage />);
    await screen.findByText('Casual Leave · 3 days');

    fireEvent.click(screen.getByRole('button', { name: 'Approve Casual Leave · 3 days' }));
    fireEvent.change(screen.getByLabelText('Note (optional)'), {
      target: { value: 'Enjoy the break' },
    });
    workflowApi.getInbox.mockResolvedValue({ data: { items: [expenseItem] } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));

    await waitFor(() =>
      expect(workflowApi.approve).toHaveBeenCalledWith('LEAVE', 'leave-1', 'Enjoy the break'),
    );
    await waitFor(() => expect(workflowApi.getInbox).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledWith('Request approved');
    await waitFor(() =>
      expect(screen.queryByText('Casual Leave · 3 days')).not.toBeInTheDocument(),
    );
  });

  it('rejects through the same dialog', async () => {
    render(<MyApprovalsPage />);
    await screen.findByText('Travel · ₹12,000');

    fireEvent.click(screen.getByRole('button', { name: 'Reject Travel · ₹12,000' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reject' }));

    await waitFor(() =>
      expect(workflowApi.reject).toHaveBeenCalledWith('EXPENSE', 'exp-1', ''),
    );
    expect(workflowApi.approve).not.toHaveBeenCalled();
  });

  it('offers no Reject for a payroll run (runs are reset, not rejected)', async () => {
    workflowApi.getInbox.mockResolvedValue({ data: { items: [payrollItem, leaveItem] } });
    render(<MyApprovalsPage />);
    await screen.findByText('March 2026 payroll');

    expect(
      screen.getByRole('button', { name: 'Approve March 2026 payroll' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reject March 2026 payroll' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reject Casual Leave · 3 days' }),
    ).toBeInTheDocument();
  });

  it('requires a reason to reject a loan', async () => {
    workflowApi.getInbox.mockResolvedValue({ data: { items: [loanItem] } });
    render(<MyApprovalsPage />);
    await screen.findByText('Personal loan · ₹50,000');

    fireEvent.click(screen.getByRole('button', { name: 'Reject Personal loan · ₹50,000' }));
    const confirm = screen.getByRole('button', { name: 'Confirm reject' });
    expect(screen.getByLabelText('Reason (required)')).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason (required)'), { target: { value: '   ' } });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'Existing loan still open' },
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(workflowApi.reject).toHaveBeenCalledWith('LOAN', 'loan-1', 'Existing loan still open'),
    );
  });

  it('keeps the loan approve note optional', async () => {
    workflowApi.getInbox.mockResolvedValue({ data: { items: [loanItem] } });
    render(<MyApprovalsPage />);
    await screen.findByText('Personal loan · ₹50,000');

    fireEvent.click(screen.getByRole('button', { name: 'Approve Personal loan · ₹50,000' }));
    expect(screen.getByLabelText('Note (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm approve' })).toBeEnabled();
  });

  it('shows the API error and keeps the dialog open when approval fails', async () => {
    workflowApi.approve.mockRejectedValue({
      response: { data: { message: 'This step is not yours to approve' } },
    });
    render(<MyApprovalsPage />);
    await screen.findByText('Casual Leave · 3 days');

    fireEvent.click(screen.getByRole('button', { name: 'Approve Casual Leave · 3 days' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm approve' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('This step is not yours to approve'),
    );
    expect(screen.getByRole('button', { name: 'Confirm approve' })).toBeInTheDocument();
  });

  it('loads the approval trail only when expanded', async () => {
    render(<MyApprovalsPage />);
    await screen.findByText('Casual Leave · 3 days');
    expect(workflowApi.getTrail).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Show approval trail' })[0]);

    await waitFor(() => expect(workflowApi.getTrail).toHaveBeenCalledWith('LEAVE', 'leave-1'));
    expect(await screen.findByText('2. HR review')).toBeInTheDocument();
    expect(screen.getByText('Awaiting action')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is waiting', async () => {
    workflowApi.getInbox.mockResolvedValue({ data: { items: [] } });
    render(<MyApprovalsPage />);
    expect(await screen.findByText('All caught up')).toBeInTheDocument();
  });

  it('shows a loading state before the inbox arrives', () => {
    workflowApi.getInbox.mockReturnValue(new Promise(() => {}));
    render(<MyApprovalsPage />);
    expect(screen.getByText('Loading your approvals...')).toBeInTheDocument();
  });
});
