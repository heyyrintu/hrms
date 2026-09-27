import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import toast from 'react-hot-toast';

import { RunAdjustmentsTabs } from './RunAdjustmentsTabs';
import type { RunContext } from './types';

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

jest.mock('@/lib/api', () => ({
  api: { get: jest.fn() },
  payrollApi: { getRuns: jest.fn() },
  employeesApi: { getAll: jest.fn() },
}));

jest.mock('@/lib/api-payroll-depth', () => {
  const actual = jest.requireActual('@/lib/api-payroll-depth');
  return {
    ...actual,
    payrollDepthApi: {
      listOneTimePayments: jest.fn(),
      createOneTimePayment: jest.fn(),
      deleteOneTimePayment: jest.fn(),
      listArrears: jest.fn(),
      holdSalary: jest.fn(),
      unhold: jest.fn(),
      releaseHold: jest.fn(),
      voidHold: jest.fn(),
      getRunReimbursements: jest.fn(),
      attachSettlement: jest.fn(),
      detachSettlement: jest.fn(),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { api, payrollApi, employeesApi } = require('@/lib/api');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { payrollDepthApi } = require('@/lib/api-payroll-depth');

const asha = { id: 'e1', employeeCode: 'EMP001', firstName: 'Asha', lastName: 'Rao' };
const vikram = { id: 'e2', employeeCode: 'EMP002', firstName: 'Vikram', lastName: 'Shah' };
const meera = { id: 'e3', employeeCode: 'EMP003', firstName: 'Meera', lastName: 'Iyer' };

const runRef = { id: 'run-1', month: 3, year: 2026, runType: 'REGULAR', sequence: 0, status: 'COMPUTED' };

const makeRun = (over: Partial<RunContext> = {}): RunContext => ({
  id: 'run-1',
  month: 3,
  year: 2026,
  status: 'COMPUTED',
  runType: 'REGULAR',
  sequence: 0,
  ...over,
});

const hold = (over: Record<string, unknown> = {}) => ({
  id: 'hold-1',
  employee: asha,
  payrollRun: runRef,
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

function renderTabs(over: Partial<React.ComponentProps<typeof RunAdjustmentsTabs>> = {}) {
  const props: React.ComponentProps<typeof RunAdjustmentsTabs> = {
    run: makeRun(),
    scopeEmployeeIds: [],
    payslipEmployees: [asha],
    holds: [],
    holdsLoading: false,
    holdsError: false,
    reloadHolds: jest.fn(),
    onInputsChanged: jest.fn(),
    ...over,
  };
  render(<RunAdjustmentsTabs {...props} />);
  return props;
}

const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('RunAdjustmentsTabs', () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    employeesApi.getAll.mockResolvedValue({ data: { data: [asha, vikram] } });
    payrollDepthApi.listOneTimePayments.mockResolvedValue({ data: [] });
    payrollDepthApi.createOneTimePayment.mockResolvedValue({ data: {} });
    payrollDepthApi.deleteOneTimePayment.mockResolvedValue({ data: {} });
    payrollDepthApi.listArrears.mockResolvedValue({ data: [] });
    payrollDepthApi.holdSalary.mockResolvedValue({ data: {} });
    payrollDepthApi.unhold.mockResolvedValue({ data: {} });
    payrollDepthApi.releaseHold.mockResolvedValue({ data: {} });
    payrollDepthApi.voidHold.mockResolvedValue({ data: {} });
    payrollDepthApi.attachSettlement.mockResolvedValue({ data: {} });
    payrollDepthApi.detachSettlement.mockResolvedValue({ data: {} });
    payrollApi.getRuns.mockResolvedValue({ data: [] });
  });

  afterEach(() => confirmSpy.mockRestore());

  describe('one-time payments', () => {
    const payment = {
      id: 'otp-1',
      payrollRunId: 'run-1',
      employee: asha,
      kind: 'BONUS',
      isEarning: true,
      name: 'Diwali bonus',
      amount: 5000,
      taxable: true,
      note: null,
      createdAt: '2026-03-20T12:00:00Z',
    };

    it('shows the empty state', async () => {
      renderTabs();
      expect(await screen.findByText('No one-time payments in this run.')).toBeInTheDocument();
    });

    it('adds a taxable earning and tells the page its inputs changed', async () => {
      const props = renderTabs();
      await screen.findByText('No one-time payments in this run.');
      await waitFor(() => expect(screen.getByRole('option', { name: 'Vikram Shah (EMP002)' })).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e2' } });
      fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'INCENTIVE' } });
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Q4 incentive ' } });
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2500.50' } });
      fireEvent.click(screen.getByLabelText('Taxable'));
      fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));

      await waitFor(() =>
        expect(payrollDepthApi.createOneTimePayment).toHaveBeenCalledWith('run-1', {
          employeeId: 'e2',
          kind: 'INCENTIVE',
          name: 'Q4 incentive',
          amount: 2500.5,
          taxable: false,
        }),
      );
      await waitFor(() => expect(props.onInputsChanged).toHaveBeenCalled());
    });

    it('sends no taxable flag for a deduction kind and hides the checkbox', async () => {
      renderTabs();
      await screen.findByText('No one-time payments in this run.');

      fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });
      fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'RECOVERY' } });
      expect(screen.queryByLabelText('Taxable')).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Laptop damage' } });
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '1000' } });
      fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Agreed' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));

      await waitFor(() =>
        expect(payrollDepthApi.createOneTimePayment).toHaveBeenCalledWith('run-1', {
          employeeId: 'e1',
          kind: 'RECOVERY',
          name: 'Laptop damage',
          amount: 1000,
          note: 'Agreed',
        }),
      );
    });

    it('rejects a zero amount without calling the API', async () => {
      renderTabs();
      await screen.findByText('No one-time payments in this run.');
      fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bonus' } });
      fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));

      expect(await screen.findByText('The amount must be greater than zero')).toBeInTheDocument();
      expect(payrollDepthApi.createOneTimePayment).not.toHaveBeenCalled();
    });

    it('lists and deletes a payment', async () => {
      payrollDepthApi.listOneTimePayments.mockResolvedValue({ data: [payment] });
      const props = renderTabs();

      expect(await screen.findByText('Diwali bonus')).toBeInTheDocument();
      expect(within(screen.getByRole('table')).getByText('Taxable')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Delete Diwali bonus' }));

      await waitFor(() => expect(payrollDepthApi.deleteOneTimePayment).toHaveBeenCalledWith('otp-1'));
      await waitFor(() => expect(props.onInputsChanged).toHaveBeenCalled());
    });

    it('is read-only once the run is approved', async () => {
      payrollDepthApi.listOneTimePayments.mockResolvedValue({ data: [payment] });
      renderTabs({ run: makeRun({ status: 'APPROVED' }) });

      expect(await screen.findByText('Diwali bonus')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add payment' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete Diwali bonus' })).not.toBeInTheDocument();
    });

    it('shows an error state with retry', async () => {
      payrollDepthApi.listOneTimePayments.mockRejectedValueOnce(new Error('boom'));
      renderTabs();
      expect(await screen.findByText(/Failed to load one-time payments/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('No one-time payments in this run.')).toBeInTheDocument();
    });

    it('offers only the scope of an off-cycle run', async () => {
      employeesApi.getAll.mockResolvedValue({ data: { data: [asha, vikram, meera] } });
      renderTabs({
        run: makeRun({ runType: 'OFF_CYCLE', sequence: 1, status: 'DRAFT' }),
        payslipEmployees: [],
        scopeEmployeeIds: ['e3'],
      });
      await waitFor(() => expect(screen.getByRole('option', { name: 'Meera Iyer (EMP003)' })).toBeInTheDocument());
      expect(screen.queryByRole('option', { name: 'Vikram Shah (EMP002)' })).not.toBeInTheDocument();
      // An off-cycle scope may include inactive employees, so no status filter.
      expect(employeesApi.getAll).toHaveBeenCalledWith({ limit: 1000 });
    });
  });

  describe('holds', () => {
    it('holds an employee with a reason', async () => {
      const props = renderTabs();
      openTab('Holds');
      expect(screen.getByText('No salaries are held in this run.')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('option', { name: 'Asha Rao (EMP001)' })).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText('Employee'), { target: { value: 'e1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Hold salary' }));
      expect(await screen.findByText('Give a reason for the hold')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Absconding' } });
      fireEvent.click(screen.getByRole('button', { name: 'Hold salary' }));
      await waitFor(() =>
        expect(payrollDepthApi.holdSalary).toHaveBeenCalledWith('run-1', { employeeId: 'e1', reason: 'Absconding' }),
      );
      expect(props.reloadHolds).toHaveBeenCalled();
    });

    it('cannot hold on a paid run and offers release and void but not unhold', async () => {
      renderTabs({ run: makeRun({ status: 'PAID' }), holds: [hold()] as any });
      openTab('Holds');

      expect(screen.queryByRole('button', { name: 'Hold salary' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Unhold' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Release' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
    });

    it('unholds on a computed run (no release before approval)', async () => {
      const props = renderTabs({ holds: [hold()] as any });
      openTab('Holds');

      expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Unhold' }));
      await waitFor(() => expect(payrollDepthApi.unhold).toHaveBeenCalledWith('hold-1'));
      expect(props.reloadHolds).toHaveBeenCalled();
    });

    it('releases into a later draft or computed run only', async () => {
      payrollApi.getRuns.mockResolvedValue({
        data: [
          { id: 'run-1', month: 3, year: 2026, status: 'APPROVED', runType: 'REGULAR', sequence: 0 },
          { id: 'run-feb', month: 2, year: 2026, status: 'DRAFT', runType: 'REGULAR', sequence: 0 },
          { id: 'run-apr', month: 4, year: 2026, status: 'DRAFT', runType: 'REGULAR', sequence: 0 },
          { id: 'run-oc', month: 3, year: 2026, status: 'COMPUTED', runType: 'OFF_CYCLE', sequence: 1 },
          { id: 'run-may', month: 5, year: 2026, status: 'PAID', runType: 'REGULAR', sequence: 0 },
        ],
      });
      const props = renderTabs({ run: makeRun({ status: 'APPROVED' }), holds: [hold()] as any });
      openTab('Holds');
      fireEvent.click(screen.getByRole('button', { name: 'Release' }));

      const select = await screen.findByLabelText('Target run');
      const options = within(select).getAllByRole('option').map((o) => o.textContent);
      expect(options).toEqual(['Choose a run', 'Apr 2026 (DRAFT)', 'Mar 2026 · Off-cycle #1 (COMPUTED)']);

      fireEvent.change(select, { target: { value: 'run-oc' } });
      fireEvent.click(screen.getAllByRole('button', { name: 'Release' }).at(-1)!);
      await waitFor(() => expect(payrollDepthApi.releaseHold).toHaveBeenCalledWith('hold-1', 'run-oc'));
      expect(props.reloadHolds).toHaveBeenCalled();
    });

    it('voids with a required reason', async () => {
      renderTabs({ holds: [hold()] as any });
      openTab('Holds');
      fireEvent.click(screen.getByRole('button', { name: 'Void' }));

      const dialogVoid = () => screen.getAllByRole('button', { name: 'Void' }).at(-1)!;
      fireEvent.click(dialogVoid());
      expect(await screen.findByText('Give a reason for voiding')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Reason', { selector: 'textarea' }), {
        target: { value: 'Left without notice' },
      });
      fireEvent.click(dialogVoid());
      await waitFor(() => expect(payrollDepthApi.voidHold).toHaveBeenCalledWith('hold-1', 'Left without notice'));
    });

    it('surfaces the backend message on failure', async () => {
      payrollDepthApi.unhold.mockRejectedValue({ response: { data: { message: 'The run is paid' } } });
      renderTabs({ holds: [hold()] as any });
      openTab('Holds');
      fireEvent.click(screen.getByRole('button', { name: 'Unhold' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The run is paid'));
    });
  });

  describe('reimbursements', () => {
    it('explains when payroll reimbursement is off', async () => {
      payrollDepthApi.getRunReimbursements.mockResolvedValue({ data: { enabled: false, claims: [], total: 0 } });
      renderTabs();
      openTab('Reimbursements');
      expect(await screen.findByText(/is not enabled/)).toBeInTheDocument();
    });

    it('lists attached and eligible claims', async () => {
      payrollDepthApi.getRunReimbursements.mockResolvedValue({
        data: {
          enabled: true,
          total: 1500,
          claims: [
            { id: 'c1', employee: asha, categoryName: 'Travel', amount: 1000, expenseDate: '2026-03-05T12:00:00Z', approvedAt: null, attached: true },
            { id: 'c2', employee: vikram, categoryName: 'Meals', amount: 500, expenseDate: '2026-03-06T12:00:00Z', approvedAt: null, attached: false },
          ],
        },
      });
      renderTabs();
      openTab('Reimbursements');
      expect(await screen.findByText('Travel')).toBeInTheDocument();
      expect(screen.getByText('Attached')).toBeInTheDocument();
      expect(screen.getByText('Eligible')).toBeInTheDocument();
      expect(screen.getByText(/1 attached, 1 eligible/)).toBeInTheDocument();
    });
  });

  describe('arrears', () => {
    const arrear = (id: string, runId: string | null, amount: number) => ({
      id,
      employee: asha,
      employeeSalaryId: 's1',
      forMonth: 1,
      forYear: 2026,
      financialYear: 2025,
      originalAmount: 50000,
      revisedAmount: 50000 + amount,
      amount,
      pfWagesDelta: 0,
      lines: [{ name: 'Basic', original: 25000, revised: 25000 + amount, delta: amount }],
      status: runId ? 'INCLUDED' : 'PENDING',
      payrollRun: runId ? { ...runRef, id: runId } : null,
      createdAt: '2026-03-01T12:00:00Z',
    });

    it('shows only the arrears included in this run', async () => {
      payrollDepthApi.listArrears.mockResolvedValue({
        data: [arrear('a1', 'run-1', 3000), arrear('a2', 'run-other', 7000), arrear('a3', null, 9000)],
      });
      renderTabs();
      openTab('Arrears');
      expect(await screen.findByText('₹3,000')).toBeInTheDocument();
      expect(screen.queryByText('₹7,000')).not.toBeInTheDocument();
      expect(screen.queryByText('₹9,000')).not.toBeInTheDocument();
      expect(screen.getByText('FY 2025-26')).toBeInTheDocument();
    });

    it('shows the empty state', async () => {
      renderTabs();
      openTab('Arrears');
      expect(await screen.findByText('No arrears are included in this run.')).toBeInTheDocument();
    });
  });

  describe('settlements', () => {
    const settlement = (id: string, runId: string | null) => ({
      id,
      employee: meera,
      status: 'APPROVED',
      netPayable: 84000,
      lastWorkingDate: '2026-02-28T12:00:00Z',
      payrollRunId: runId,
    });

    it('is offered only for off-cycle runs', () => {
      renderTabs();
      expect(screen.queryByRole('tab', { name: 'Settlements' })).not.toBeInTheDocument();
    });

    it('attaches and detaches settlements on a draft off-cycle run', async () => {
      api.get.mockResolvedValue({
        data: { attached: [settlement('set-1', 'run-1')], eligible: [settlement('set-2', null)] },
      });
      const props = renderTabs({ run: makeRun({ runType: 'OFF_CYCLE', sequence: 1, status: 'DRAFT' }) });
      openTab('Settlements');

      expect(await screen.findByText('Paid through this run')).toBeInTheDocument();
      expect(api.get).toHaveBeenCalledWith('/payroll/runs/run-1/settlements');

      fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
      await waitFor(() => expect(payrollDepthApi.attachSettlement).toHaveBeenCalledWith('run-1', 'set-2'));
      await waitFor(() => expect(props.onInputsChanged).toHaveBeenCalled());

      fireEvent.click(await screen.findByRole('button', { name: 'Detach' }));
      await waitFor(() => expect(payrollDepthApi.detachSettlement).toHaveBeenCalledWith('run-1', 'set-1'));
    });

    it('is read-only on an approved off-cycle run', async () => {
      api.get.mockResolvedValue({ data: { attached: [settlement('set-1', 'run-1')], eligible: [settlement('set-2', null)] } });
      renderTabs({ run: makeRun({ runType: 'OFF_CYCLE', sequence: 1, status: 'APPROVED' }) });
      openTab('Settlements');
      expect(await screen.findByText('Paid through this run')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Detach' })).not.toBeInTheDocument();
      expect(screen.queryByText('Eligible settlements')).not.toBeInTheDocument();
    });
  });
});
