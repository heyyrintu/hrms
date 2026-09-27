import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';

import PayrollRunDetailPage from './page';

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
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useParams: () => ({ id: 'run-1' }),
  usePathname: () => '/payroll/runs/run-1',
  useSearchParams: () => new URLSearchParams(),
}));

const mockHasRole = jest.fn().mockReturnValue(true);
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', role: 'HR_ADMIN', tenantId: 't1' },
    isAuthenticated: true,
    isLoading: false,
    isAdmin: true,
    isSuperAdmin: false,
    hasRole: (...roles: string[]) => mockHasRole(...roles),
  }),
}));

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn() },
  payrollApi: {
    getRun: jest.fn(),
    getRuns: jest.fn(),
    processRun: jest.fn(),
    approveRun: jest.fn(),
    markAsPaid: jest.fn(),
    downloadPayslip: jest.fn(),
  },
  employeesApi: { getAll: jest.fn() },
}));

jest.mock('@/lib/api-payroll-depth', () => {
  const actual = jest.requireActual('@/lib/api-payroll-depth');
  return {
    ...actual,
    payrollDepthApi: {
      listRunHolds: jest.fn(),
      listOneTimePayments: jest.fn(),
      createOneTimePayment: jest.fn(),
      deleteOneTimePayment: jest.fn(),
      listArrears: jest.fn(),
      getRunReimbursements: jest.fn(),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { payrollApi, employeesApi } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { payrollDepthApi } = require('@/lib/api-payroll-depth');

const asha = { id: 'e1', employeeCode: 'EMP001', firstName: 'Asha', lastName: 'Rao' };
const vikram = { id: 'e2', employeeCode: 'EMP002', firstName: 'Vikram', lastName: 'Shah' };

const payslip = (id: string, employee: typeof asha, over: Record<string, unknown> = {}) => ({
  id,
  tenantId: 't1',
  payrollRunId: 'run-1',
  employeeId: employee.id,
  workingDays: 22,
  presentDays: 22,
  leaveDays: 0,
  lopDays: 0,
  otHours: '0.00',
  basePay: '50000.00',
  earnings: [],
  deductions: [],
  grossPay: '50000.00',
  totalDeductions: '5000.00',
  netPay: '45000.00',
  otPay: '0.00',
  nonTaxableEarnings: '0.00',
  arrearsAmount: '0.00',
  reimbursementAmount: '0.00',
  employee,
  createdAt: '2026-03-31T12:00:00Z',
  updatedAt: '2026-03-31T12:00:00Z',
  ...over,
});

const makeRun = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  tenantId: 't1',
  month: 3,
  year: 2026,
  status: 'COMPUTED',
  runType: 'REGULAR',
  sequence: 0,
  needsRecompute: false,
  offCycleReason: null,
  includeSalary: false,
  scopeEmployeeIds: [],
  paidAt: null,
  totalGross: '100000.00',
  totalDeductions: '10000.00',
  totalNet: '90000.00',
  processedCount: 2,
  createdAt: '2026-03-01T12:00:00Z',
  updatedAt: '2026-03-01T12:00:00Z',
  payslips: [payslip('p1', asha), payslip('p2', vikram)],
  ...over,
});

const hold = (status: string) => ({
  id: 'hold-1',
  employee: asha,
  payrollRun: { id: 'run-1', month: 3, year: 2026, runType: 'REGULAR', sequence: 0, status: 'COMPUTED' },
  reason: 'Absconding',
  status,
  heldAmount: null,
  releaseRun: null,
  releasedAt: null,
  voidedAt: null,
  voidReason: null,
  createdAt: '2026-03-20T12:00:00Z',
});

describe('PayrollRunDetailPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(true);
    payrollApi.getRun.mockResolvedValue({ data: makeRun() });
    payrollApi.getRuns.mockResolvedValue({ data: [] });
    employeesApi.getAll.mockResolvedValue({ data: { data: [asha, vikram] } });
    payrollDepthApi.listRunHolds.mockResolvedValue({ data: [] });
    payrollDepthApi.listOneTimePayments.mockResolvedValue({ data: [] });
    payrollDepthApi.createOneTimePayment.mockResolvedValue({ data: {} });
    payrollDepthApi.listArrears.mockResolvedValue({ data: [] });
  });

  it('shows a loading state, then the run with its payslips', async () => {
    render(<PayrollRunDetailPage />);
    expect(screen.queryByText('March 2026')).not.toBeInTheDocument();

    expect(await screen.findByText('March 2026')).toBeInTheDocument();
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getByText('Vikram Shah')).toBeInTheDocument();
    expect(screen.getByText('Regular')).toBeInTheDocument();
    expect(payrollApi.getRun).toHaveBeenCalledWith('run-1');
    expect(payrollDepthApi.listRunHolds).toHaveBeenCalledWith('run-1');
  });

  it('shows a not-found state when the run cannot be loaded', async () => {
    payrollApi.getRun.mockRejectedValue(new Error('404'));
    render(<PayrollRunDetailPage />);
    expect(await screen.findByText('Payroll run not found.')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalled();
  });

  it('shows the empty payslip state for a draft run', async () => {
    payrollApi.getRun.mockResolvedValue({ data: makeRun({ status: 'DRAFT', payslips: [] }) });
    render(<PayrollRunDetailPage />);
    expect(await screen.findByText('No payslips yet. Process this run to generate payslips.')).toBeInTheDocument();
  });

  it('warns when inputs changed since the run was computed', async () => {
    payrollApi.getRun.mockResolvedValue({ data: makeRun({ needsRecompute: true }) });
    render(<PayrollRunDetailPage />);
    expect(
      await screen.findByText('Inputs changed since this run was computed — recompute before approval'),
    ).toBeInTheDocument();
  });

  it('does not warn when the run is current', async () => {
    render(<PayrollRunDetailPage />);
    await screen.findByText('March 2026');
    expect(screen.queryByText(/Inputs changed since this run was computed/)).not.toBeInTheDocument();
  });

  it('badges off-cycle runs with their sequence and reason', async () => {
    payrollApi.getRun.mockResolvedValue({
      data: makeRun({ runType: 'OFF_CYCLE', sequence: 2, offCycleReason: 'Missed joiner' }),
    });
    render(<PayrollRunDetailPage />);
    expect(await screen.findByText('Off-cycle #2')).toBeInTheDocument();
    expect(screen.getByText('Missed joiner')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settlements' })).toBeInTheDocument();
  });

  it('marks held and voided employees as Held, but not released ones', async () => {
    payrollDepthApi.listRunHolds.mockResolvedValue({ data: [hold('HELD')] });
    render(<PayrollRunDetailPage />);
    const row = (await screen.findByText('Asha Rao')).closest('tr')!;
    await waitFor(() => expect(within(row).getByText('Held')).toBeInTheDocument());
    const other = screen.getByText('Vikram Shah').closest('tr')!;
    expect(within(other).queryByText('Held')).not.toBeInTheDocument();
  });

  it('treats a voided hold as held too', async () => {
    payrollDepthApi.listRunHolds.mockResolvedValue({ data: [hold('VOIDED')] });
    render(<PayrollRunDetailPage />);
    const row = (await screen.findByText('Asha Rao')).closest('tr')!;
    await waitFor(() => expect(within(row).getByText('Held')).toBeInTheDocument());
  });

  it('does not badge a released hold', async () => {
    payrollDepthApi.listRunHolds.mockResolvedValue({ data: [hold('RELEASED')] });
    render(<PayrollRunDetailPage />);
    const row = (await screen.findByText('Asha Rao')).closest('tr')!;
    await waitFor(() => expect(payrollDepthApi.listRunHolds).toHaveBeenCalled());
    expect(within(row).queryByText('Held')).not.toBeInTheDocument();
  });

  it('shows non-taxable earnings, arrears and reimbursements on a payslip', async () => {
    payrollApi.getRun.mockResolvedValue({
      data: makeRun({
        payslips: [
          payslip('p1', asha, { nonTaxableEarnings: '1200.00', arrearsAmount: '3000.00', reimbursementAmount: '1200.00' }),
        ],
      }),
    });
    render(<PayrollRunDetailPage />);
    const row = (await screen.findByText('Asha Rao')).closest('tr')!;
    expect(within(row).getByText('Arrears ₹3,000')).toBeInTheDocument();
    expect(within(row).getByText('Reimb. ₹1,200')).toBeInTheDocument();
    expect(within(row).getByText('Non-taxable ₹1,200')).toBeInTheDocument();
  });

  it('refetches the run after a one-time payment is added to a computed run', async () => {
    render(<PayrollRunDetailPage />);
    await screen.findByText('No one-time payments in this run.');
    expect(payrollApi.getRun).toHaveBeenCalledTimes(1);

    payrollApi.getRun.mockResolvedValue({ data: makeRun({ needsRecompute: true }) });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Asha Rao (EMP001)' })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bonus' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));

    await waitFor(() => expect(payrollApi.getRun).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText('Inputs changed since this run was computed — recompute before approval'),
    ).toBeInTheDocument();
    // The refetch keeps the page (and the open tab) mounted.
    expect(screen.getByRole('tab', { name: 'One-time payments' })).toHaveAttribute('aria-selected', 'true');
  });

  it('hides the adjustment tabs from non-payroll roles', async () => {
    mockHasRole.mockReturnValue(false);
    render(<PayrollRunDetailPage />);
    await screen.findByText('March 2026');
    expect(screen.queryByRole('tab', { name: 'One-time payments' })).not.toBeInTheDocument();
    expect(payrollDepthApi.listRunHolds).not.toHaveBeenCalled();
  });
});
