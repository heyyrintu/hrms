/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { payrollDepthApi } from './api-payroll-depth';

/**
 * Pins every route of the payroll run mechanics client (Keka wave C, WS-C1) to
 * the backend contract in the spec's "C API summary", since the two are built
 * in parallel.
 */
describe('payroll depth API requests', () => {
  let sent: InternalAxiosRequestConfig[];

  beforeEach(() => {
    sent = [];
    api.defaults.adapter = async (config) => {
      sent.push(config);
      return {
        data: {},
        status: 200,
        statusText: 'OK',
        headers: new AxiosHeaders(),
        config,
      };
    };
  });

  const body = (i = 0) => (sent[i].data ? JSON.parse(sent[i].data) : undefined);

  it('creates an off-cycle run with POST /payroll/runs/off-cycle', async () => {
    const payload = {
      month: 3,
      year: 2026,
      reason: 'Missed joiner',
      includeSalary: true,
      employeeIds: ['e1', 'e2'],
    };
    await payrollDepthApi.createOffCycleRun(payload);
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/payroll/runs/off-cycle');
    expect(body()).toEqual(payload);
  });

  it('lists one-time payments with GET /payroll/runs/:id/one-time-payments', async () => {
    await payrollDepthApi.listOneTimePayments('run-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/runs/run-1/one-time-payments');
  });

  it('adds a one-time payment with POST /payroll/runs/:id/one-time-payments', async () => {
    const payload = {
      employeeId: 'e1',
      kind: 'BONUS' as const,
      name: 'Diwali bonus',
      amount: 5000,
      taxable: true,
      note: 'Festival',
    };
    await payrollDepthApi.createOneTimePayment('run-1', payload);
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/payroll/runs/run-1/one-time-payments');
    expect(body()).toEqual(payload);
  });

  it('deletes a one-time payment with DELETE /payroll/one-time-payments/:id', async () => {
    await payrollDepthApi.deleteOneTimePayment('otp-1');
    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/payroll/one-time-payments/otp-1');
  });

  it('lists arrears with GET /payroll/arrears and its filters as params', async () => {
    await payrollDepthApi.listArrears({ status: 'PENDING', employeeId: 'e1' });
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/arrears');
    expect(sent[0].params).toEqual({ status: 'PENDING', employeeId: 'e1' });
  });

  it('lists arrears without filters', async () => {
    await payrollDepthApi.listArrears();
    expect(sent[0].url).toBe('/payroll/arrears');
    expect(sent[0].params).toBeUndefined();
  });

  it('detects arrears with POST /payroll/arrears/detect { employeeId }', async () => {
    await payrollDepthApi.detectArrears('e1');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/payroll/arrears/detect');
    expect(body()).toEqual({ employeeId: 'e1' });
  });

  it('cancels an arrear with POST /payroll/arrears/:id/cancel', async () => {
    await payrollDepthApi.cancelArrear('arr-1');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/payroll/arrears/arr-1/cancel');
  });

  it('lists the holds of a run with GET /payroll/runs/:id/holds', async () => {
    await payrollDepthApi.listRunHolds('run-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/runs/run-1/holds');
  });

  it('lists holds with GET /payroll/holds and a status param', async () => {
    await payrollDepthApi.listHolds('HELD');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/holds');
    expect(sent[0].params).toEqual({ status: 'HELD' });
  });

  it('lists every hold without a status param', async () => {
    await payrollDepthApi.listHolds();
    expect(sent[0].url).toBe('/payroll/holds');
    expect(sent[0].params).toBeUndefined();
  });

  it('holds a salary with POST /payroll/runs/:id/holds', async () => {
    await payrollDepthApi.holdSalary('run-1', { employeeId: 'e1', reason: 'Absconding' });
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/payroll/runs/run-1/holds');
    expect(body()).toEqual({ employeeId: 'e1', reason: 'Absconding' });
  });

  it('unholds with DELETE /payroll/holds/:id', async () => {
    await payrollDepthApi.unhold('hold-1');
    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/payroll/holds/hold-1');
  });

  it('releases a hold with POST /payroll/holds/:id/release { targetRunId }', async () => {
    await payrollDepthApi.releaseHold('hold-1', 'run-2');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/payroll/holds/hold-1/release');
    expect(body()).toEqual({ targetRunId: 'run-2' });
  });

  it('voids a hold with POST /payroll/holds/:id/void { reason }', async () => {
    await payrollDepthApi.voidHold('hold-1', 'Left without notice');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/payroll/holds/hold-1/void');
    expect(body()).toEqual({ reason: 'Left without notice' });
  });

  it('reads run reimbursements with GET /payroll/runs/:id/reimbursements', async () => {
    await payrollDepthApi.getRunReimbursements('run-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/runs/run-1/reimbursements');
  });

  it('attaches a settlement with POST /payroll/runs/:id/settlements { settlementId }', async () => {
    await payrollDepthApi.attachSettlement('run-1', 'set-1');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/payroll/runs/run-1/settlements');
    expect(body()).toEqual({ settlementId: 'set-1' });
  });

  it('detaches a settlement with DELETE /payroll/runs/:id/settlements/:settlementId', async () => {
    await payrollDepthApi.detachSettlement('run-1', 'set-1');
    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/payroll/runs/run-1/settlements/set-1');
  });

  it('reads settings with GET /payroll/settings', async () => {
    await payrollDepthApi.getSettings();
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/settings');
  });

  it('saves settings with PUT /payroll/settings', async () => {
    await payrollDepthApi.updateSettings({ reimburseExpensesViaPayroll: true, autoArrears: false });
    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/payroll/settings');
    expect(body()).toEqual({ reimburseExpensesViaPayroll: true, autoArrears: false });
  });
});
