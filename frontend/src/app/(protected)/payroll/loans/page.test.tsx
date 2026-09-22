import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PayrollLoansPage from './page';
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

const activeLoan = {
  id: 'loan-1',
  employeeId: 'emp-1',
  type: 'LOAN' as const,
  principal: 120000,
  interestRate: 10,
  tenureMonths: 12,
  emiAmount: 11000,
  totalPayable: 132000,
  outstandingAmount: 121000,
  startMonth: 1,
  startYear: 2026,
  status: 'ACTIVE' as const,
  createdAt: '2026-01-05T12:00:00Z',
  employee: {
    id: 'emp-1',
    firstName: 'Asha',
    lastName: 'Rao',
    employeeCode: 'E001',
  },
};

const closedLoan = {
  ...activeLoan,
  id: 'loan-2',
  status: 'CLOSED' as const,
  outstandingAmount: 0,
};

describe('PayrollLoansPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getAll.mockResolvedValue({ data: { data: [activeLoan] } } as any);
  });

  it('loads the active loans first', async () => {
    render(<PayrollLoansPage />);
    await waitFor(() =>
      expect(api.getAll).toHaveBeenCalledWith({ status: 'ACTIVE' }),
    );
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  });

  it('shows the balance against the register row', async () => {
    render(<PayrollLoansPage />);
    await screen.findByText('Asha Rao');
    expect(screen.getByText('₹1,21,000')).toBeInTheDocument();
    expect(screen.getByText('₹11,000')).toBeInTheDocument();
  });

  it('drops the status filter entirely on the All tab', async () => {
    render(<PayrollLoansPage />);
    await screen.findByText('Asha Rao');

    fireEvent.click(screen.getByText('All'));

    await waitFor(() => expect(api.getAll).toHaveBeenLastCalledWith(undefined));
  });

  it('only offers a manual repayment on an active loan', async () => {
    api.getAll.mockResolvedValue({ data: { data: [closedLoan] } } as any);
    render(<PayrollLoansPage />);

    await screen.findByText('Asha Rao');
    expect(screen.queryByText('Record Repayment')).not.toBeInTheDocument();
  });

  it('prefills the repayment with the EMI and posts what was entered', async () => {
    api.recordRepayment.mockResolvedValue({ data: { id: 'r1' } } as any);
    render(<PayrollLoansPage />);

    fireEvent.click(await screen.findByText('Record Repayment'));

    const amount = screen.getByLabelText('Amount *') as HTMLInputElement;
    expect(amount.value).toBe('11000');

    fireEvent.change(amount, { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Month *'), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText('Year *'), {
      target: { value: '2026' },
    });
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'NEFT 123' },
    });

    fireEvent.click(screen.getByText('Save Repayment'));

    await waitFor(() =>
      expect(api.recordRepayment).toHaveBeenCalledWith('loan-1', {
        month: 3,
        year: 2026,
        amount: 5000,
        note: 'NEFT 123',
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Repayment recorded');
  });

  it('never prefills more than the outstanding balance', async () => {
    api.getAll.mockResolvedValue({
      data: { data: [{ ...activeLoan, outstandingAmount: 500 }] },
    } as any);
    render(<PayrollLoansPage />);

    fireEvent.click(await screen.findByText('Record Repayment'));

    expect((screen.getByLabelText('Amount *') as HTMLInputElement).value).toBe(
      '500',
    );
  });

  it('surfaces the API message when the repayment is refused', async () => {
    api.recordRepayment.mockRejectedValue({
      response: { data: { message: 'Amount exceeds the outstanding balance of 500' } },
    });
    render(<PayrollLoansPage />);

    fireEvent.click(await screen.findByText('Record Repayment'));
    fireEvent.click(screen.getByText('Save Repayment'));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        'Amount exceeds the outstanding balance of 500',
      ),
    );
  });

  it('opens the repayment history and schedule', async () => {
    api.getById.mockResolvedValue({
      data: {
        ...activeLoan,
        repayments: [
          {
            id: 'r1',
            loanId: 'loan-1',
            month: 1,
            year: 2026,
            amount: 11000,
            source: 'PAYROLL',
            note: null,
            createdAt: '2026-01-31T12:00:00Z',
          },
        ],
        schedule: [
          {
            month: 1,
            year: 2026,
            emi: 11000,
            principalComponent: 10000,
            interestComponent: 1000,
            balanceAfter: 121000,
          },
        ],
      },
    } as any);

    render(<PayrollLoansPage />);
    fireEvent.click(await screen.findByText('History'));

    await waitFor(() => expect(api.getById).toHaveBeenCalledWith('loan-1'));
    expect(await screen.findByText('PAYROLL')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
  });

  it('says so when a loan has no repayments yet', async () => {
    api.getById.mockResolvedValue({
      data: { ...activeLoan, repayments: [], schedule: [] },
    } as any);

    render(<PayrollLoansPage />);
    fireEvent.click(await screen.findByText('History'));

    expect(
      await screen.findByText('No repayments recorded yet.'),
    ).toBeInTheDocument();
  });

  it('renders the empty state', async () => {
    api.getAll.mockResolvedValue({ data: { data: [] } } as any);
    render(<PayrollLoansPage />);
    expect(await screen.findByText('No loans')).toBeInTheDocument();
  });

  it('tells the user when the register cannot be loaded', async () => {
    api.getAll.mockRejectedValue(new Error('boom'));
    render(<PayrollLoansPage />);
    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load loans'),
    );
  });
});
