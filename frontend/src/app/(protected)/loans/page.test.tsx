import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MyLoansPage from './page';
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
  default: { success: (m: string) => mockToast.success(m), error: (m: string) => mockToast.error(m) },
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
  purpose: 'Home repair',
  status: 'ACTIVE' as const,
  createdAt: '2026-01-05T12:00:00Z',
};

const requestedLoan = {
  ...activeLoan,
  id: 'loan-2',
  status: 'REQUESTED' as const,
  outstandingAmount: 132000,
};

describe('MyLoansPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getMy.mockResolvedValue({ data: { data: [activeLoan] } } as any);
  });

  it('renders the heading once the list has loaded', async () => {
    render(<MyLoansPage />);
    expect(await screen.findByText(/Loans & Advances/)).toBeInTheDocument();
  });

  it('loads my loans on first render', async () => {
    render(<MyLoansPage />);
    await waitFor(() => expect(api.getMy).toHaveBeenCalled());
  });

  it('shows the loan with its EMI and outstanding balance', async () => {
    render(<MyLoansPage />);
    expect(await screen.findByText(/12 months at 10%/)).toBeInTheDocument();
    expect(screen.getByText(/Outstanding/)).toBeInTheDocument();
  });

  it('renders the empty state when nothing has been requested', async () => {
    api.getMy.mockResolvedValue({ data: { data: [] } } as any);
    render(<MyLoansPage />);
    expect(await screen.findByText('No loans yet')).toBeInTheDocument();
  });

  it('tells the user when the list cannot be loaded', async () => {
    api.getMy.mockRejectedValue(new Error('boom'));
    render(<MyLoansPage />);
    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load your loans'),
    );
  });

  it('previews the EMI client-side before anything is submitted', async () => {
    render(<MyLoansPage />);
    fireEvent.click(await screen.findByText('New Request'));

    fireEvent.change(screen.getByLabelText('Amount *'), {
      target: { value: '120000' },
    });
    fireEvent.change(screen.getByLabelText('Interest rate (%)'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Tenure (months) *'), {
      target: { value: '12' },
    });

    const preview = await screen.findByTestId('emi-preview');
    // 120000 at 10% simple over 12 months: 132000 total, 11000 a month.
    expect(preview).toHaveTextContent('₹11,000');
    expect(preview).toHaveTextContent('₹1,32,000');
    // The interest is the difference, not the whole total.
    expect(preview).toHaveTextContent('₹12,000');
  });

  it('forces a salary advance to zero interest in the preview', async () => {
    render(<MyLoansPage />);
    fireEvent.click(await screen.findByText('New Request'));

    fireEvent.change(screen.getByLabelText('Interest rate (%)'), {
      target: { value: '10' },
    });
    fireEvent.change(screen.getByLabelText('Type *'), {
      target: { value: 'SALARY_ADVANCE' },
    });
    fireEvent.change(screen.getByLabelText('Amount *'), {
      target: { value: '30000' },
    });
    fireEvent.change(screen.getByLabelText('Tenure (months) *'), {
      target: { value: '3' },
    });

    expect(screen.getByLabelText('Interest rate (%)')).toBeDisabled();
    const preview = await screen.findByTestId('emi-preview');
    expect(preview).toHaveTextContent('₹10,000');
    expect(preview).toHaveTextContent('₹0');
  });

  it('flags a salary advance tenure longer than twelve months', async () => {
    render(<MyLoansPage />);
    fireEvent.click(await screen.findByText('New Request'));

    fireEvent.change(screen.getByLabelText('Type *'), {
      target: { value: 'SALARY_ADVANCE' },
    });
    fireEvent.change(screen.getByLabelText('Tenure (months) *'), {
      target: { value: '13' },
    });

    expect(
      await screen.findByText('Maximum 12 months for this type.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Submit Request')).toBeDisabled();
  });

  it('submits the request with the entered terms', async () => {
    api.request.mockResolvedValue({ data: { id: 'loan-9' } } as any);
    render(<MyLoansPage />);
    fireEvent.click(await screen.findByText('New Request'));

    fireEvent.change(screen.getByLabelText('Amount *'), {
      target: { value: '60000' },
    });
    fireEvent.change(screen.getByLabelText('Interest rate (%)'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByLabelText('Tenure (months) *'), {
      target: { value: '6' },
    });
    fireEvent.change(screen.getByLabelText('Purpose'), {
      target: { value: 'School fees' },
    });

    fireEvent.click(screen.getByText('Submit Request'));

    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LOAN',
          principal: 60000,
          interestRate: 6,
          tenureMonths: 6,
          purpose: 'School fees',
        }),
      ),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Request submitted');
  });

  it('surfaces the API message when the request is refused', async () => {
    api.request.mockRejectedValue({
      response: { data: { message: 'A salary advance is interest free' } },
    });
    render(<MyLoansPage />);
    fireEvent.click(await screen.findByText('New Request'));

    fireEvent.change(screen.getByLabelText('Amount *'), {
      target: { value: '1000' },
    });
    fireEvent.click(screen.getByText('Submit Request'));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        'A salary advance is interest free',
      ),
    );
  });

  it('opens the schedule from the server for a loan', async () => {
    api.getById.mockResolvedValue({
      data: {
        ...activeLoan,
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
        repayments: [
          {
            id: 'r1',
            loanId: 'loan-1',
            month: 1,
            year: 2026,
            amount: 11000,
            source: 'PAYROLL',
            createdAt: '2026-01-31T12:00:00Z',
          },
        ],
      },
    } as any);

    render(<MyLoansPage />);
    fireEvent.click(await screen.findByText('Schedule'));

    await waitFor(() => expect(api.getById).toHaveBeenCalledWith('loan-1'));
    expect(await screen.findByText('Jan 2026')).toBeInTheDocument();
    expect(screen.getByText('Repayments so far')).toBeInTheDocument();
  });

  it('explains an arrears instalment due after the tenure ends', async () => {
    api.getById.mockResolvedValue({
      data: {
        ...activeLoan,
        outstandingAmount: 116000,
        schedule: [
          {
            month: 12,
            year: 2026,
            emi: 11000,
            principalComponent: 10000,
            interestComponent: 1000,
            balanceAfter: 0,
          },
        ],
        repayments: [],
        arrears: {
          amount: 6000,
          instalments: [{ month: 1, year: 2027, amount: 6000 }],
        },
      },
    } as any);

    render(<MyLoansPage />);
    fireEvent.click(await screen.findByText('Schedule'));

    const note = await screen.findByTestId('arrears-note');
    expect(note).toHaveTextContent('₹6,000');
    expect(note).toHaveTextContent(/net pay/i);
    expect(note).toHaveTextContent('Jan 2027');
    // And the instalment is a row of the schedule, marked as arrears, so the
    // extra deduction on the payslip has a line to match against.
    const row = screen.getByTestId('arrears-row-2027-1');
    expect(row).toHaveTextContent('Jan 2027');
    expect(row).toHaveTextContent(/arrears/i);
    expect(row).toHaveTextContent('₹6,000');
  });

  it('shows no arrears note for a loan on schedule', async () => {
    api.getById.mockResolvedValue({
      data: {
        ...activeLoan,
        schedule: [],
        repayments: [],
        arrears: { amount: 0, instalments: [] },
      },
    } as any);

    render(<MyLoansPage />);
    fireEvent.click(await screen.findByText('Schedule'));

    await waitFor(() => expect(api.getById).toHaveBeenCalled());
    expect(screen.queryByTestId('arrears-note')).not.toBeInTheDocument();
  });

  it('offers to withdraw only a request that is still pending', async () => {
    api.getMy.mockResolvedValue({
      data: { data: [activeLoan, requestedLoan] },
    } as any);
    render(<MyLoansPage />);

    await screen.findAllByText(/12 months at 10%/);
    expect(screen.getAllByText('Withdraw')).toHaveLength(1);
  });

  it('withdraws a pending request and reloads', async () => {
    api.getMy.mockResolvedValue({ data: { data: [requestedLoan] } } as any);
    api.cancel.mockResolvedValue({ data: {} } as any);
    render(<MyLoansPage />);

    fireEvent.click(await screen.findByText('Withdraw'));
    // The confirmation dialog repeats the label on its confirm button.
    const confirm = screen.getAllByText('Withdraw').pop() as HTMLElement;
    fireEvent.click(confirm);

    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('loan-2'));
    expect(mockToast.success).toHaveBeenCalledWith('Request withdrawn');
  });
});
