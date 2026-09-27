import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';

import SalaryHoldsPage from './page';

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
  payrollApi: { getRuns: jest.fn() },
}));

jest.mock('@/lib/api-payroll-depth', () => {
  const actual = jest.requireActual('@/lib/api-payroll-depth');
  return {
    ...actual,
    payrollDepthApi: { listHolds: jest.fn(), releaseHold: jest.fn(), voidHold: jest.fn() },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { payrollApi } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { payrollDepthApi } = require('@/lib/api-payroll-depth');

const asha = { id: 'e1', employeeCode: 'EMP001', firstName: 'Asha', lastName: 'Rao' };
const vikram = { id: 'e2', employeeCode: 'EMP002', firstName: 'Vikram', lastName: 'Shah' };
const marchRun = { id: 'run-mar', month: 3, year: 2026, runType: 'REGULAR', sequence: 0, status: 'PAID' };

const hold = (over: Record<string, unknown> = {}) => ({
  id: 'hold-1',
  employee: asha,
  payrollRun: marchRun,
  reason: 'Absconding',
  status: 'HELD',
  heldAmount: null,
  releaseRun: null,
  releasedAt: null,
  voidedAt: null,
  voidReason: null,
  createdAt: '2026-03-20T12:00:00Z',
  ...over,
});

describe('SalaryHoldsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockReturnValue(true);
    payrollDepthApi.listHolds.mockResolvedValue({ data: [] });
    payrollDepthApi.releaseHold.mockResolvedValue({ data: {} });
    payrollDepthApi.voidHold.mockResolvedValue({ data: {} });
    payrollApi.getRuns.mockResolvedValue({
      data: [
        marchRun,
        { id: 'run-apr', month: 4, year: 2026, runType: 'REGULAR', sequence: 0, status: 'DRAFT' },
        { id: 'run-feb', month: 2, year: 2026, runType: 'REGULAR', sequence: 0, status: 'COMPUTED' },
      ],
    });
  });

  it('refuses other roles', () => {
    mockHasRole.mockReturnValue(false);
    render(<SalaryHoldsPage />);
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
    expect(payrollDepthApi.listHolds).not.toHaveBeenCalled();
  });

  it('shows the loading then empty state', async () => {
    render(<SalaryHoldsPage />);
    expect(screen.getByText('Loading holds…')).toBeInTheDocument();
    expect(await screen.findByText('No salary holds match this filter.')).toBeInTheDocument();
    expect(payrollDepthApi.listHolds).toHaveBeenCalledWith(undefined);
  });

  it('shows an error state with retry', async () => {
    payrollDepthApi.listHolds.mockRejectedValueOnce(new Error('boom'));
    render(<SalaryHoldsPage />);
    expect(await screen.findByText(/Failed to load holds/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No salary holds match this filter.')).toBeInTheDocument();
  });

  it('filters by status', async () => {
    render(<SalaryHoldsPage />);
    await screen.findByText('No salary holds match this filter.');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'RELEASED' } });
    await waitFor(() => expect(payrollDepthApi.listHolds).toHaveBeenLastCalledWith('RELEASED'));
  });

  it('lists holds with their runs and held amounts', async () => {
    payrollDepthApi.listHolds.mockResolvedValue({
      data: [
        hold(),
        hold({
          id: 'hold-2',
          employee: vikram,
          status: 'RELEASED',
          heldAmount: 45000,
          releaseRun: { id: 'run-oc', month: 4, year: 2026, runType: 'OFF_CYCLE', sequence: 1, status: 'PAID' },
        }),
      ],
    });
    render(<SalaryHoldsPage />);

    const released = (await screen.findByText('Vikram Shah')).closest('tr')!;
    expect(within(released).getByText('₹45,000')).toBeInTheDocument();
    expect(within(released).getByText('Apr 2026 · Off-cycle #1')).toBeInTheDocument();
    expect(within(released).queryByRole('button')).not.toBeInTheDocument();

    const held = screen.getByText('Asha Rao').closest('tr')!;
    expect(within(held).getByText('Mar 2026')).toBeInTheDocument();
    expect(within(held).getByRole('button', { name: 'Release' })).toBeInTheDocument();
    expect(within(held).getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('does not offer release while the held run is not yet approved', async () => {
    payrollDepthApi.listHolds.mockResolvedValue({
      data: [hold({ payrollRun: { ...marchRun, status: 'COMPUTED' } })],
    });
    render(<SalaryHoldsPage />);
    await screen.findByText('Asha Rao');
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('releases into a draft or computed run from the held month onwards', async () => {
    payrollDepthApi.listHolds.mockResolvedValue({ data: [hold()] });
    render(<SalaryHoldsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }));

    const select = await screen.findByLabelText('Target run');
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Choose a run', 'Apr 2026 (DRAFT)']);

    fireEvent.change(select, { target: { value: 'run-apr' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Release' }).at(-1)!);
    await waitFor(() => expect(payrollDepthApi.releaseHold).toHaveBeenCalledWith('hold-1', 'run-apr'));
    expect(toast.success).toHaveBeenCalledWith('Held salary released');
    await waitFor(() => expect(payrollDepthApi.listHolds).toHaveBeenCalledTimes(2));
  });

  it('voids a hold with a reason', async () => {
    payrollDepthApi.listHolds.mockResolvedValue({ data: [hold()] });
    render(<SalaryHoldsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Left without notice' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Void' }).at(-1)!);
    await waitFor(() => expect(payrollDepthApi.voidHold).toHaveBeenCalledWith('hold-1', 'Left without notice'));
  });

  it('surfaces the backend message when a release fails', async () => {
    payrollDepthApi.releaseHold.mockRejectedValue({ response: { data: { message: 'Target run is approved' } } });
    payrollDepthApi.listHolds.mockResolvedValue({ data: [hold()] });
    render(<SalaryHoldsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Release' }));
    fireEvent.change(await screen.findByLabelText('Target run'), { target: { value: 'run-apr' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Release' }).at(-1)!);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Target run is approved'));
  });
});
