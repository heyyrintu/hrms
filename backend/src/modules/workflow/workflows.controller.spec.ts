import { Reflector } from '@nestjs/core';
import { ArgumentMetadata, BadRequestException, ParseEnumPipe } from '@nestjs/common';
import { WorkflowEntityType } from '@prisma/client';
import { WorkflowsController } from './workflows.controller';
import { ApprovalsController } from './approvals.controller';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { mockHrAdmin, mockEmployee } from '../../test/helpers';

describe('WorkflowsController', () => {
  const definitions = {
    list: jest.fn().mockResolvedValue(['list']),
    get: jest.fn().mockResolvedValue('one'),
    upsert: jest.fn().mockResolvedValue('saved'),
    reset: jest.fn().mockResolvedValue('reset'),
  };
  const controller = new WorkflowsController(definitions as any);

  it('is restricted to SUPER_ADMIN and HR_ADMIN', () => {
    const roles = new Reflector().get(ROLES_KEY, WorkflowsController);
    expect(roles).toEqual(['SUPER_ADMIN', 'HR_ADMIN']);
  });

  it('routes list / get / upsert / reset to the service with the tenant', async () => {
    await expect(controller.list(mockHrAdmin)).resolves.toEqual(['list']);
    expect(definitions.list).toHaveBeenCalledWith(mockHrAdmin.tenantId);

    await controller.get(mockHrAdmin, 'LEAVE');
    expect(definitions.get).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'LEAVE');

    const dto = { steps: [{ name: 'HR', approverType: 'HR_ADMIN' as const }] };
    await controller.upsert(mockHrAdmin, 'EXPENSE', dto);
    expect(definitions.upsert).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'EXPENSE', dto);

    await controller.reset(mockHrAdmin, 'LOAN');
    expect(definitions.reset).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'LOAN');
  });

  it('validates :entityType with ParseEnumPipe', async () => {
    const pipe = new ParseEnumPipe<any>(WorkflowEntityType);
    const meta: ArgumentMetadata = { type: 'param', data: 'entityType' };
    await expect(pipe.transform('PAYROLL_RUN', meta)).resolves.toBe('PAYROLL_RUN');
    await expect(pipe.transform('leave', meta)).rejects.toThrow(BadRequestException);
  });
});

describe('ApprovalsController', () => {
  const engine = {
    getInbox: jest.fn().mockResolvedValue([{ instanceId: 'i-1' }]),
    getTrail: jest.fn().mockResolvedValue('trail'),
  };
  const handler = { approve: jest.fn().mockResolvedValue('approved'), reject: jest.fn().mockResolvedValue('rejected') };
  const registry = { get: jest.fn().mockReturnValue(handler) };
  const delegations = {
    list: jest.fn().mockResolvedValue({ given: [], received: [] }),
    create: jest.fn().mockResolvedValue('created'),
    cancel: jest.fn().mockResolvedValue('cancelled'),
    searchUsers: jest.fn().mockResolvedValue([]),
  };
  const controller = new ApprovalsController(engine as any, registry as any, delegations as any);

  beforeEach(() => jest.clearAllMocks());

  it('is open to every role (no @Roles)', () => {
    expect(new Reflector().get(ROLES_KEY, ApprovalsController)).toBeUndefined();
    expect(new Reflector().get(ROLES_KEY, ApprovalsController.prototype.approve)).toBeUndefined();
  });

  it('declares the static routes before the :entityType routes', () => {
    const paths = Object.getOwnPropertyNames(ApprovalsController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) =>
        Reflect.getMetadata('path', (ApprovalsController.prototype as any)[name]),
      );
    const firstParam = paths.findIndex((p) => String(p).startsWith(':entityType'));
    const lastStatic = Math.max(
      ...['inbox', 'delegations', 'delegations/:id', 'users'].map((p) => paths.indexOf(p)),
    );
    expect(firstParam).toBeGreaterThan(lastStatic);
  });

  it('wraps the inbox in { items }', async () => {
    await expect(controller.inbox(mockEmployee)).resolves.toEqual({ items: [{ instanceId: 'i-1' }] });
    expect(engine.getInbox).toHaveBeenCalledWith(mockEmployee);
  });

  it('routes the trail to the engine', async () => {
    await controller.trail(mockEmployee, 'LEAVE', 'leave-1');
    expect(engine.getTrail).toHaveBeenCalledWith(mockEmployee, 'LEAVE', 'leave-1');
  });

  it('routes approve / reject to the registered handler with the note', async () => {
    await expect(controller.approve(mockEmployee, 'EXPENSE', 'exp-1', { note: 'fine' })).resolves.toBe('approved');
    expect(registry.get).toHaveBeenCalledWith('EXPENSE');
    expect(handler.approve).toHaveBeenCalledWith(mockEmployee, 'exp-1', 'fine');

    await expect(controller.reject(mockEmployee, 'LOAN', 'loan-1', {})).resolves.toBe('rejected');
    expect(handler.reject).toHaveBeenCalledWith(mockEmployee, 'loan-1', null);
  });

  it('routes delegation and user-search endpoints', async () => {
    await controller.listDelegations(mockHrAdmin, { all: true });
    expect(delegations.list).toHaveBeenCalledWith(mockHrAdmin, true);

    await controller.listDelegations(mockEmployee, {});
    expect(delegations.list).toHaveBeenCalledWith(mockEmployee, false);

    const dto = { delegateUserId: 'u-2', startDate: '2026-10-01', endDate: '2026-10-02' };
    await controller.createDelegation(mockEmployee, dto);
    expect(delegations.create).toHaveBeenCalledWith(mockEmployee, dto);

    await controller.cancelDelegation(mockEmployee, 'del-1');
    expect(delegations.cancel).toHaveBeenCalledWith(mockEmployee, 'del-1');

    await controller.searchUsers(mockEmployee, { search: 'asha' });
    expect(delegations.searchUsers).toHaveBeenCalledWith(mockEmployee.tenantId, 'asha');
  });
});
