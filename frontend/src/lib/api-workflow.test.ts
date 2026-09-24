/** @jest-environment jsdom */
import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';
import { api } from './api';
import { workflowApi } from './api-workflow';

/**
 * Pins every route of the approval engine client to the backend contract in
 * the Wave B spec ("HTTP API"), since the two are built in parallel.
 */
describe('workflow API requests', () => {
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

  it('lists definitions with GET /workflows', async () => {
    await workflowApi.listDefinitions();
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/workflows');
  });

  it('reads one definition with GET /workflows/:entityType', async () => {
    await workflowApi.getDefinition('PAYROLL_RUN');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/workflows/PAYROLL_RUN');
  });

  it('saves a definition with PUT /workflows/:entityType', async () => {
    const payload = {
      name: 'Expense approval',
      adminOverride: true,
      allowSelfApproval: false,
      steps: [
        { name: 'Manager', approverType: 'REPORTING_MANAGER' as const },
        {
          name: 'Finance',
          approverType: 'SPECIFIC_USER' as const,
          approverUserId: 'u-9',
          minAmount: 5000,
        },
      ],
    };
    await workflowApi.saveDefinition('EXPENSE', payload);
    expect(sent[0].method).toBe('put');
    expect(sent[0].url).toBe('/workflows/EXPENSE');
    expect(body()).toEqual(payload);
  });

  it('resets a definition with DELETE /workflows/:entityType', async () => {
    await workflowApi.resetDefinition('LEAVE');
    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/workflows/LEAVE');
  });

  it('reads the inbox with GET /approvals/inbox', async () => {
    await workflowApi.getInbox();
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/approvals/inbox');
  });

  it('reads a trail with GET /approvals/:entityType/:entityId/trail', async () => {
    await workflowApi.getTrail('COMP_OFF', 'c-1');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/approvals/COMP_OFF/c-1/trail');
  });

  it('approves with POST .../approve and the note', async () => {
    await workflowApi.approve('LEAVE', 'l-1', '  Enjoy  ');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/approvals/LEAVE/l-1/approve');
    expect(body()).toEqual({ note: 'Enjoy' });
  });

  it('approves without a note when none is given', async () => {
    await workflowApi.approve('LEAVE', 'l-1', '   ');
    expect(body()).toEqual({});
  });

  it('rejects with POST .../reject and the note', async () => {
    await workflowApi.reject('LOAN', 'n-1', 'Too large');
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/approvals/LOAN/n-1/reject');
    expect(body()).toEqual({ note: 'Too large' });
  });

  it('lists delegations with GET /approvals/delegations', async () => {
    await workflowApi.getDelegations();
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/approvals/delegations');
  });

  it('passes all=true for the tenant-wide delegation list', async () => {
    await workflowApi.getDelegations({ all: true });
    expect(sent[0].params).toEqual({ all: true });
  });

  it('creates a delegation with POST /approvals/delegations', async () => {
    const payload = {
      delegateUserId: 'u-2',
      startDate: '2026-10-01',
      endDate: '2026-10-05',
      entityType: 'EXPENSE' as const,
      reason: 'On leave',
    };
    await workflowApi.createDelegation(payload);
    expect(sent[0].method).toBe('post');
    expect(sent[0].url).toBe('/approvals/delegations');
    expect(body()).toEqual(payload);
  });

  it('cancels a delegation with DELETE /approvals/delegations/:id', async () => {
    await workflowApi.cancelDelegation('d-1');
    expect(sent[0].method).toBe('delete');
    expect(sent[0].url).toBe('/approvals/delegations/d-1');
  });

  it('searches users with GET /approvals/users?search=', async () => {
    await workflowApi.searchUsers('asha');
    expect(sent[0].method).toBe('get');
    expect(sent[0].url).toBe('/approvals/users');
    expect(sent[0].params).toEqual({ search: 'asha' });
  });
});
