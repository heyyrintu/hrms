import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';

import SalaryArrearsPage from './page';

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

const mockHasRole = jest.fn().mockReturnValue(true);
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', role: 'HR_ADMIN', tenantId: 't1' },
    isLoading: false,
    isAdmin: true,
    hasRole: (...roles: string[]) => mockHasRole(...roles),
  }),
}));

jest.mock('@/lib/api', () => ({
  employeesApi: { getAll: jest.fn() },
}));

jest.mock('@/lib/api-payroll-depth', () => {
  const actual = jest.requireActual('@/lib/api-payroll-depth');
  return {
    ...actual,
    payrollDepthApi: { listArrears: jest.fn(), detectArrears: jest.fn(), cancelArrear: jest.fn() },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { employeesApi } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { payrollDepthApi } = require('@/lib/api-payroll-depth');

const asha = { id: 'e1', employeeCode: 'EMP001', firstName: 'Asha', lastName: 'Rao' };
const vikram = { id: 'e2', employeeCode: 'EMP002', firstName: 'Vikram', lastName: 'Shah' };

const arrear = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  employee: asha,
  employeeSalaryId: 's1',
  forMonth: 1,
  forYear: 2026,
  financialYear: 2025,
  originalAmount: 50000,
  revisedAmount: 53000,
  amount: 3000,
  pfWagesDelta: 1500,
  lines: [
    { name: 'Basic', original: 25000, revised: 26500, delta: 1500 },
    { name: 'HRA', original: 10000, revised: 11500, delta: 1500 },
  ],
  status: 'PENDING',
  payrollRun: null,
  createdAt: '2026-03-01T12:00:00Z',
  ...over,
});

describe('SalaryArrearsPage', () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(true);
    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    employeesApi.getAll.mockResolvedValue({ data: { data: [asha, vikram] } });
    payrollDepthApi.listArrears.mockResolvedValue({ data: [] });
    payrollDepthApi.detectArrears.mockResolvedValue({ data: { created: 2, arrears: [] } });
    payrollDepthApi.cancelArrear.mockResolvedValue({ data: {} });
  });

  afterEach(() => confirmSpy.mockRestore());

  it('refuses other roles', () => {
    mockHasRole.mockReturnValue(false);
    render(<SalaryArrearsPage />);
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
    expect(payrollDepthApi.listArrears).not.toHaveBeenCalled();
  });

  it('shows the loading then empty state', async () => {
    render(<SalaryArrearsPage />);
    expect(screen.getByText('Loading arrears…')).toBeInTheDocument();
    expect(await screen.findByText('No arrears match these filters.')).toBeInTheDocument();
    expect(payrollDepthApi.listArrears).toHaveBeenCalledWith(undefined);
  });

  it('shows an error state with retry', async () => {
    payrollDepthApi.listArrears.mockRejectedValueOnce(new Error('boom'));
    render(<SalaryArrearsPage />);
    expect(await screen.findByText(/Failed to load arrears/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No arrears match these filters.')).toBeInTheDocument();
  });

  it('lists arrears, shows a negative amount as a recovery and expands the component lines', async () => {
    payrollDepthApi.listArrears.mockResolvedValue({
      data: [
        arrear(),
        arrear({
          id: 'a2',
          employee: vikram,
          forMonth: 2,
          amount: -2000,
          revisedAmount: 48000,
          status: 'INCLUDED',
          payrollRun: { id: 'run-1', month: 3, year: 2026, runType: 'OFF_CYCLE', sequence: 1, status: 'COMPUTED' },
        }),
      ],
    });
    render(<SalaryArrearsPage />);

    expect(await screen.findByText('₹3,000')).toBeInTheDocument();
    expect(screen.getByText('−₹2,000')).toBeInTheDocument();
    expect(screen.getByText('Recovery')).toBeInTheDocument();
    expect(screen.getByText('Mar 2026 · Off-cycle #1')).toBeInTheDocument();
    expect(screen.getAllByText('FY 2025-26')).toHaveLength(2);

    expect(screen.queryByText('HRA')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show components for Asha Rao Jan 2026' }));
    expect(screen.getByText('HRA')).toBeInTheDocument();
  });

  it('filters by status and employee', async () => {
    render(<SalaryArrearsPage />);
    await screen.findByText('No arrears match these filters.');
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Vikram Shah (EMP002)' }).length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PENDING' } });
    await waitFor(() => expect(payrollDepthApi.listArrears).toHaveBeenLastCalledWith({ status: 'PENDING' }));

    fireEvent.change(screen.getByLabelText('Filter by employee'), { target: { value: 'e2' } });
    await waitFor(() =>
      expect(payrollDepthApi.listArrears).toHaveBeenLastCalledWith({ status: 'PENDING', employeeId: 'e2' }),
    );
  });

  it('detects arrears for an employee and reports how many were created', async () => {
    render(<SalaryArrearsPage />);
    await screen.findByText('No arrears match these filters.');
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Asha Rao (EMP001)' }).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: 'Detect arrears' }));
    expect(payrollDepthApi.detectArrears).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Detect for employee'), { target: { value: 'e1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Detect arrears' }));

    await waitFor(() => expect(payrollDepthApi.detectArrears).toHaveBeenCalledWith('e1'));
    expect(toast.success).toHaveBeenCalledWith('2 new arrears detected');
    await waitFor(() => expect(payrollDepthApi.listArrears).toHaveBeenCalledTimes(2));
  });

  it('cancels a pending arrear after confirmation', async () => {
    payrollDepthApi.listArrears.mockResolvedValue({
      data: [arrear(), arrear({ id: 'a2', status: 'PAID', forMonth: 2 })],
    });
    render(<SalaryArrearsPage />);
    await screen.findAllByText('₹3,000');

    const cancels = screen.getAllByRole('button', { name: 'Cancel' });
    expect(cancels).toHaveLength(1);
    fireEvent.click(cancels[0]);
    await waitFor(() => expect(payrollDepthApi.cancelArrear).toHaveBeenCalledWith('a1'));
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('does nothing when the cancel is not confirmed', async () => {
    confirmSpy.mockReturnValue(false);
    payrollDepthApi.listArrears.mockResolvedValue({ data: [arrear()] });
    render(<SalaryArrearsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(payrollDepthApi.cancelArrear).not.toHaveBeenCalled();
  });

  it('surfaces the backend message when detection fails', async () => {
    payrollDepthApi.detectArrears.mockRejectedValue({ response: { data: { message: 'Employee not found' } } });
    render(<SalaryArrearsPage />);
    await screen.findByText('No arrears match these filters.');
    await waitFor(() => expect(screen.getAllByRole('option', { name: 'Asha Rao (EMP001)' }).length).toBeGreaterThan(0));
    fireEvent.change(screen.getByLabelText('Detect for employee'), { target: { value: 'e1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Detect arrears' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Employee not found'));
  });
});
