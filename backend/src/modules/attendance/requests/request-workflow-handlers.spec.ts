import { WfhRequestWorkflowHandler } from './wfh-request-workflow.handler';
import { OnDutyRequestWorkflowHandler } from './on-duty-request-workflow.handler';

describe.each([
  ['WFH_REQUEST', 'WFH', WfhRequestWorkflowHandler],
  ['ON_DUTY_REQUEST', 'ON_DUTY', OnDutyRequestWorkflowHandler],
] as const)('%s workflow handler', (entityType, requestType, Handler) => {
  const tenantId = 'tenant-1';
  const actor: any = { userId: 'u', tenantId, role: 'MANAGER', employeeId: 'e' };
  let registry: { register: jest.Mock };
  let requests: Record<string, jest.Mock>;
  let handler: InstanceType<typeof Handler>;

  beforeEach(() => {
    registry = { register: jest.fn() };
    requests = {
      getContext: jest.fn().mockResolvedValue(null),
      describe: jest.fn().mockResolvedValue([]),
      approve: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
    };
    handler = new Handler(registry as any, requests as any);
  });

  it('registers itself on module init', () => {
    handler.onModuleInit();
    expect(handler.entityType).toBe(entityType);
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('getContext asks the service for its own type only', async () => {
    requests.getContext.mockResolvedValue({
      requesterEmployeeId: 'emp-1',
      requesterUserId: 'u1',
      days: 2,
    });
    await expect(handler.getContext(tenantId, 'req-1')).resolves.toEqual({
      requesterEmployeeId: 'emp-1',
      requesterUserId: 'u1',
      days: 2,
    });
    expect(requests.getContext).toHaveBeenCalledWith(tenantId, 'req-1', requestType);
  });

  it('getContext is null when the service finds no PENDING row of this type', async () => {
    await expect(handler.getContext(tenantId, 'req-1')).resolves.toBeNull();
  });

  it('describe filters by its own type', async () => {
    await handler.describe(tenantId, ['a', 'b']);
    expect(requests.describe).toHaveBeenCalledWith(tenantId, ['a', 'b'], requestType);
  });

  it('approve and reject delegate with the note', async () => {
    await handler.approve(actor, 'req-1', 'ok');
    await handler.reject(actor, 'req-1', 'no');
    expect(requests.approve).toHaveBeenCalledWith(actor, 'req-1', 'ok');
    expect(requests.reject).toHaveBeenCalledWith(actor, 'req-1', 'no');
  });
});
