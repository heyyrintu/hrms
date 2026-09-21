import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import LoanApprovalsPage from './page';
import { loansApi } from '@/lib/api-loans';

jest.mock('lucide-react', () =>
  new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === '__esModule') return true;
        return (props: any) => (
          <span data-testid={`icon-${String(prop)}`} {...props} />
        );
      },
    },
  ),
);

jest.mock('@/components/ui/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

jest.mock('@/components/ui/Button', () => ({
  Button: ({ children, loading, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock('@/components/ui/Badge', () => ({
  Badge: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));

jest.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title }: any) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  ModalFooter: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('@/lib/api-loans', () => ({
  loansApi: {
    request: jest.fn(),
    getMy: jest.fn(),
    getAll: jest.fn(),
    getById: jest.fn(),
    cancel: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    disburse: jest.fn(),
    recordRepayment: jest.fn(),
  },
}));

jest.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

const mockToast = { success: jest.fn(), error: jest.fn() };
jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: {
    success: (m: string) => mockToast.success(m),
    error: (m: string) => mockToast.error(m),
  },
}));

const api = loansApi as jest.Mocked<typeof loansApi>;

const pendingLoan = {
  id: 'loan-1',
  employeeId: 'emp-1',
  type: 'LOAN' as const,
  principal: 120000,
  interestRate: 10,
  tenureMonths: 12,
  emiAmount: 11000,
  totalPayable: 132000,
  outstandingAmount: 132000,
  startMonth: 1,
  startYear: 2026,
  purpose: 'Home repair',
  status: 'REQUESTED' as const,
  createdAt: '2026-01-05T12:00:00Z',
  employee: {
    id: 'emp-1',
    firstName: 'Asha',
    lastName: 'Rao',
    employeeCode: 'E001',
  },
};

const approvedLoan = {
  ...pendingLoan,
  id: 'loan-2',
  status: 'APPROVED' as const,
};

describe('LoanApprovalsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getAll.mockResolvedValue({ data: { data: [pendingLoan] } } as any);
  });

  it('loads the pending queue first', async () => {
    render(<LoanApprovalsPage />);
    await waitFor(() =>
      expect(api.getAll).toHaveBeenCalledWith({ status: 'REQUESTED' }),
    );
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  });

  it('shows the terms the approver is signing off', async () => {
    render(<LoanApprovalsPage />);
    expect(
      await screen.findByText(/over 12 months at 10%/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Purpose: Home repair/)).toBeInTheDocument();
  });

  it('switches to the awaiting-disbursement queue', async () => {
    render(<LoanApprovalsPage />);
    await screen.findByText('Asha Rao');

    api.getAll.mockResolvedValue({ data: { data: [approvedLoan] } } as any);
    fireEvent.click(screen.getByText('Awaiting disbursement'));

    await waitFor(() =>
      expect(api.getAll).toHaveBeenLastCalledWith({ status: 'APPROVED' }),
    );
    expect(await screen.findByText('Mark Disbursed')).toBeInTheDocument();
  });

  it('approves a pending request and reloads', async () => {
    api.approve.mockResolvedValue({ data: {} } as any);
    render(<LoanApprovalsPage />);

    fireEvent.click(await screen.findByText('Approve'));

    await waitFor(() => expect(api.approve).toHaveBeenCalledWith('loan-1'));
    expect(mockToast.success).toHaveBeenCalledWith('Loan approved');
    expect(api.getAll).toHaveBeenCalledTimes(2);
  });

  it('never offers Approve on an already-approved loan', async () => {
    api.getAll.mockResolvedValue({ data: { data: [approvedLoan] } } as any);
    render(<LoanApprovalsPage />);

    await screen.findByText('Mark Disbursed');
    expect(screen.queryByText('Approve')).not.toBeInTheDocument();
    expect(screen.queryByText('Reject')).not.toBeInTheDocument();
  });

  it('requires a reason before it will reject', async () => {
    render(<LoanApprovalsPage />);
    fireEvent.click(await screen.findByText('Reject'));

    const confirm = screen.getAllByText('Reject').pop() as HTMLElement;
    expect(confirm).toBeDisabled();
    expect(api.reject).not.toHaveBeenCalled();
  });

  it('rejects with the reason the approver typed', async () => {
    api.reject.mockResolvedValue({ data: {} } as any);
    render(<LoanApprovalsPage />);
    fireEvent.click(await screen.findByText('Reject'));

    fireEvent.change(screen.getByLabelText('Reason *'), {
      target: { value: 'An existing loan is still open' },
    });
    fireEvent.click(screen.getAllByText('Reject').pop() as HTMLElement);

    await waitFor(() =>
      expect(api.reject).toHaveBeenCalledWith(
        'loan-1',
        'An existing loan is still open',
      ),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Loan rejected');
  });

  it('disburses an approved loan', async () => {
    api.getAll.mockResolvedValue({ data: { data: [approvedLoan] } } as any);
    api.disburse.mockResolvedValue({ data: {} } as any);
    render(<LoanApprovalsPage />);

    fireEvent.click(await screen.findByText('Mark Disbursed'));

    await waitFor(() => expect(api.disburse).toHaveBeenCalledWith('loan-2'));
    expect(mockToast.success).toHaveBeenCalledWith('Marked as disbursed');
  });

  it('surfaces the API message when an action is refused', async () => {
    api.approve.mockRejectedValue({
      response: { data: { message: 'A loan in status APPROVED cannot move to APPROVED' } },
    });
    render(<LoanApprovalsPage />);

    fireEvent.click(await screen.findByText('Approve'));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        'A loan in status APPROVED cannot move to APPROVED',
      ),
    );
  });

  it('renders an empty queue message', async () => {
    api.getAll.mockResolvedValue({ data: { data: [] } } as any);
    render(<LoanApprovalsPage />);
    expect(await screen.findByText('Nothing to action')).toBeInTheDocument();
  });

  it('tells the user when the queue cannot be loaded', async () => {
    api.getAll.mockRejectedValue(new Error('boom'));
    render(<LoanApprovalsPage />);
    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to load loan requests',
      ),
    );
  });
});
