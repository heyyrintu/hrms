/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { payrollAccountingApi } from './api-payroll-accounting';

/**
 * Pins every route of the accounting export / variance report client (Keka
 * wave C, WS-C2) to the backend contract in the spec's "C API summary".
 */
describe('payroll accounting API requests', () => {
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

  it('gets the accounting config with GET /payroll/accounting/config', async () => {
    await payrollAccountingApi.getConfig();
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/accounting/config');
  });

  it('updates the accounting config with PUT /payroll/accounting/config', async () => {
    const payload = { costCenterMode: 'DEPARTMENT' as const };
    await payrollAccountingApi.updateConfig(payload);
    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/payroll/accounting/config');
    expect(body()).toEqual(payload);
  });

  it('gets the GL mappings with GET /payroll/accounting/gl-mappings', async () => {
    await payrollAccountingApi.getGlMappings();
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/accounting/gl-mappings');
  });

  it('replaces the GL mappings with PUT /payroll/accounting/gl-mappings', async () => {
    const mappings = [{ componentKey: 'BASIC', glCode: '4001', glName: 'Salaries' }];
    await payrollAccountingApi.replaceGlMappings(mappings);
    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/payroll/accounting/gl-mappings');
    expect(body()).toEqual({ mappings });
  });

  it('previews the journal with GET /payroll/accounting/runs/:runId/journal', async () => {
    await payrollAccountingApi.getJournal('run-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/accounting/runs/run-1/journal');
    expect(sent[0].params).toEqual({ allowUnmapped: false });
  });

  it('previews the journal with allowUnmapped=true when asked', async () => {
    await payrollAccountingApi.getJournal('run-1', true);
    expect(sent[0].params).toEqual({ allowUnmapped: true });
  });

  it('downloads the journal export as a blob with GET /payroll/accounting/runs/:runId/export', async () => {
    await payrollAccountingApi.exportJournal('run-1', 'tally', true);
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/accounting/runs/run-1/export');
    expect(sent[0].params).toEqual({ format: 'tally', allowUnmapped: true });
    expect(sent[0].responseType).toBe('blob');
  });

  it('gets the variance report with GET /payroll/reports/variance', async () => {
    await payrollAccountingApi.getVariance({ runId: 'run-1', compareRunId: 'run-0', thresholdPct: 15 });
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/reports/variance');
    expect(sent[0].params).toEqual({ runId: 'run-1', compareRunId: 'run-0', thresholdPct: 15 });
  });

  it('downloads the variance CSV as a blob with GET /payroll/reports/variance/export', async () => {
    await payrollAccountingApi.exportVariance({ runId: 'run-1' });
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/payroll/reports/variance/export');
    expect(sent[0].params).toEqual({ runId: 'run-1' });
    expect(sent[0].responseType).toBe('blob');
  });
});
