import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole, WorkflowEntityType } from '@prisma/client';
import { createMockNotificationsService, createMockPrismaService } from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  ApprovalEngineService,
  ALREADY_ACTIONED,
  NOT_AN_APPROVER,
  NOT_AWAITING,
  NO_APPROVAL,
  PAYROLL_SELF_APPROVAL,
  TRAIL_FORBIDDEN,
  SELF_APPROVAL,
  resolveSteps,
} from './approval-engine.service';
import { ApproverResolverService } from './approver-resolver.service';
import { WorkflowRegistry } from './workflow-registry.service';
import { ApprovalStepSnapshot, WorkflowEntityHandler } from './workflow.types';

const TENANT = 'tenant-1';

// Org chart: requester -> manager -> director. HR and a stranger on the side.
const USERS = [
  { id: 'u-req', role: UserRole.EMPLOYEE, email: 'req@x.com', employeeId: 'e-req', employee: { firstName: 'Riya', lastName: 'Req', managerId: 'e-mgr' } },
  { id: 'u-mgr', role: UserRole.MANAGER, email: 'mgr@x.com', employeeId: 'e-mgr', employee: { firstName: 'Manoj', lastName: 'Mgr', managerId: 'e-dir' } },
  { id: 'u-dir', role: UserRole.MANAGER, email: 'dir@x.com', employeeId: 'e-dir', employee: { firstName: 'Divya', lastName: 'Dir', managerId: null } },
  { id: 'u-hr', role: UserRole.HR_ADMIN, email: 'hr@x.com', employeeId: 'e-hr', employee: { firstName: 'Hari', lastName: 'HR', managerId: null } },
  { id: 'u-other', role: UserRole.EMPLOYEE, email: 'other@x.com', employeeId: 'e-other', employee: { firstName: 'Omar', lastName: 'Other', managerId: null } },
];

function actor(userId: string): AuthenticatedUser {
  const u = USERS.find((x) => x.id === userId)!;
  return { userId: u.id, email: u.email, tenantId: TENANT, role: u.role, employeeId: u.employeeId };
}

const step = (order: number, overrides: Partial<ApprovalStepSnapshot> = {}): ApprovalStepSnapshot => ({
  order,
  name: `Step ${order}`,
  approverType: 'REPORTING_MANAGER',
  approverUserId: null,
  approverRole: null,
  ...overrides,
});

function instance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inst-1',
    tenantId: TENANT,
    entityType: 'LEAVE' as WorkflowEntityType,
    entityId: 'leave-1',
    definitionId: null,
    status: 'PENDING',
    currentStepOrder: 1,
    round: 1,
    steps: [step(1)],
    adminOverride: true,
    allowSelfApproval: true,
    requesterEmployeeId: 'e-req',
    requesterUserId: 'u-req',
    amount: null,
    days: null,
    completedAt: null,
    createdAt: new Date('2026-09-20T12:00:00Z'),
    updatedAt: new Date('2026-09-20T12:00:00Z'),
    ...overrides,
  };
}

describe('ApprovalEngineService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let notifications: ReturnType<typeof createMockNotificationsService>;
  let registry: WorkflowRegistry;
  let engine: ApprovalEngineService;
  let db: any;

  function directory(opts: {
    users?: typeof USERS;
    delegations?: Array<{ delegatorUserId: string; delegateUserId: string; entityType: WorkflowEntityType | null }>;
    onLeave?: string[];
  } = {}) {
    const users = opts.users ?? USERS;
    db.user.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.isActive) return users;
      const ids: string[] = args?.where?.id?.in ?? [];
      return USERS.filter((u) => ids.includes(u.id));
    });
    db.approvalDelegation.findMany.mockResolvedValue(opts.delegations ?? []);
    db.leaveRequest.findMany.mockResolvedValue((opts.onLeave ?? []).map((employeeId) => ({ employeeId })));
    db.employee.findMany.mockResolvedValue([]);
  }

  function handler(overrides: Partial<WorkflowEntityHandler> = {}): WorkflowEntityHandler {
    return {
      entityType: 'LEAVE',
      getContext: jest.fn().mockResolvedValue(null),
      describe: jest.fn().mockImplementation(async (_t: string, ids: string[]) =>
        ids.map((id) => ({
          entityId: id,
          title: 'Casual Leave · 2 days',
          subtitle: '1 Oct – 2 Oct 2026',
          requesterName: 'Riya Req',
          link: '/approvals/leave',
          submittedAt: '2026-09-20T12:00:00.000Z',
        })),
      ),
      approve: jest.fn(),
      reject: jest.fn(),
      ...overrides,
    };
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    prisma = createMockPrismaService();
    db = prisma as any;
    notifications = createMockNotificationsService();
    registry = new WorkflowRegistry();
    engine = new ApprovalEngineService(
      prisma,
      notifications as any,
      registry,
      new ApproverResolverService(prisma),
    );
    directory();
    db.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
    db.approvalAction.create.mockResolvedValue({});
    db.approvalAction.findMany.mockResolvedValue([]);
  });

  describe('resolveSteps', () => {
    it('keeps steps whose conditions hold and renumbers them', () => {
      const steps = resolveSteps(
        [
          { name: 'Manager', approverType: 'REPORTING_MANAGER' },
          { name: 'Director', approverType: 'MANAGERS_MANAGER', minAmount: 50000 },
          { name: 'HR', approverType: 'HR_ADMIN', minDays: 3 },
        ],
        10000,
        5,
      );
      expect(steps.map((s) => [s.order, s.name])).toEqual([
        [1, 'Manager'],
        [2, 'HR'],
      ]);
    });

    it('drops conditioned steps when the value is unknown', () => {
      expect(
        resolveSteps([{ name: 'Big', approverType: 'HR_ADMIN', minAmount: 0 }], null, null),
      ).toEqual([]);
    });
  });

  describe('start', () => {
    const context = { requesterEmployeeId: 'e-req', requesterUserId: 'u-req', amount: 20000, days: 2 };

    it('filters a custom definition by minAmount / minDays and snapshots the survivors', async () => {
      db.workflowDefinition.findUnique.mockResolvedValue({
        id: 'def-1',
        adminOverride: false,
        allowSelfApproval: false,
        steps: [
          { name: 'Manager', approverType: 'REPORTING_MANAGER', approverUserId: null, approverRole: null, minAmount: null, minDays: null },
          { name: 'Finance', approverType: 'SPECIFIC_USER', approverUserId: 'u-hr', approverRole: null, minAmount: '10000', minDays: null },
          { name: 'Long leave', approverType: 'HR_ADMIN', approverUserId: null, approverRole: null, minAmount: null, minDays: '5' },
        ],
      });
      db.approvalInstance.upsert.mockImplementation(async (args: any) => ({ id: 'inst-1', ...args.create }));

      await engine.start({ tenantId: TENANT, entityType: 'EXPENSE', entityId: 'exp-1', context, tx: db });

      const args = db.approvalInstance.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ entityType_entityId: { entityType: 'EXPENSE', entityId: 'exp-1' } });
      expect(args.create).toEqual(
        expect.objectContaining({
          tenantId: TENANT,
          definitionId: 'def-1',
          round: 1,
          status: 'PENDING',
          currentStepOrder: 1,
          adminOverride: false,
          allowSelfApproval: false,
          amount: 20000,
          days: 2,
          steps: [
            { order: 1, name: 'Manager', approverType: 'REPORTING_MANAGER', approverUserId: null, approverRole: null },
            { order: 2, name: 'Finance', approverType: 'SPECIFIC_USER', approverUserId: 'u-hr', approverRole: null },
          ],
        }),
      );
    });

    it('falls back to the built-in steps when no configured step survives', async () => {
      db.workflowDefinition.findUnique.mockResolvedValue({
        id: 'def-1',
        adminOverride: true,
        allowSelfApproval: true,
        steps: [
          { name: 'Only big', approverType: 'HR_ADMIN', approverUserId: null, approverRole: null, minAmount: '999999', minDays: null },
        ],
      });
      db.approvalInstance.upsert.mockImplementation(async (args: any) => ({ id: 'inst-1', ...args.create }));

      await engine.start({ tenantId: TENANT, entityType: 'EXPENSE', entityId: 'exp-1', context, tx: db });

      expect(db.approvalInstance.upsert.mock.calls[0][0].create.steps).toEqual([
        { order: 1, name: 'Reporting manager', approverType: 'REPORTING_MANAGER', approverUserId: null, approverRole: null },
      ]);
    });

    it('uses the built-in default (payroll: no self-approval) when there is no definition', async () => {
      db.workflowDefinition.findUnique.mockResolvedValue(null);
      db.approvalInstance.upsert.mockImplementation(async (args: any) => ({ id: 'inst-1', ...args.create }));

      await engine.start({
        tenantId: TENANT,
        entityType: 'PAYROLL_RUN',
        entityId: 'run-1',
        context: { requesterEmployeeId: null, requesterUserId: 'u-hr', amount: 1_000_000 },
        tx: db,
      });

      const create = db.approvalInstance.upsert.mock.calls[0][0].create;
      expect(create.definitionId).toBeNull();
      expect(create.allowSelfApproval).toBe(false);
      expect(create.steps).toEqual([
        { order: 1, name: 'HR approval', approverType: 'HR_ADMIN', approverUserId: null, approverRole: null },
      ]);
    });

    it('restarts an existing instance: round + 1, step 1, PENDING', async () => {
      db.workflowDefinition.findUnique.mockResolvedValue(null);
      db.approvalInstance.upsert.mockResolvedValue(instance({ round: 2 }));

      await engine.start({ tenantId: TENANT, entityType: 'LEAVE', entityId: 'leave-1', context, tx: db });

      const update = db.approvalInstance.upsert.mock.calls[0][0].update;
      expect(update).toEqual(
        expect.objectContaining({
          round: { increment: 1 },
          currentStepOrder: 1,
          status: 'PENDING',
          completedAt: null,
        }),
      );
    });

    it('notifies step-1 approvers itself when not given a transaction', async () => {
      db.workflowDefinition.findUnique.mockResolvedValue(null);
      db.approvalInstance.upsert.mockResolvedValue(instance());
      db.approvalInstance.findUnique.mockResolvedValue(instance());

      await engine.start({ tenantId: TENANT, entityType: 'LEAVE', entityId: 'leave-1', context });
      await flush();

      expect(notifications.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'u-mgr', type: 'APPROVAL_REQUIRED', link: '/approvals' }),
      ]);
    });

    it('does not notify when running inside the caller transaction', async () => {
      db.workflowDefinition.findUnique.mockResolvedValue(null);
      db.approvalInstance.upsert.mockResolvedValue(instance());

      await engine.start({ tenantId: TENANT, entityType: 'LEAVE', entityId: 'leave-1', context, tx: db });
      await flush();

      expect(notifications.createMany).not.toHaveBeenCalled();
    });
  });

  describe('act', () => {
    const act = (actorId: string, decision: 'APPROVE' | 'REJECT' = 'APPROVE', onFinal?: jest.Mock) =>
      engine.act({
        tenantId: TENANT,
        entityType: 'LEAVE',
        entityId: 'leave-1',
        actor: actor(actorId),
        decision,
        note: 'ok',
        onFinal,
      });

    it('reporting manager approves a single-step chain: APPROVED and onFinal runs with tx', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance());
      const onFinal = jest.fn().mockResolvedValue(undefined);

      const result = await act('u-mgr', 'APPROVE', onFinal);

      expect(result).toEqual({ outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null });
      expect(db.approvalInstance.updateMany).toHaveBeenCalledWith({
        where: { id: 'inst-1', status: 'PENDING', currentStepOrder: 1, round: 1 },
        data: { status: 'APPROVED', completedAt: expect.any(Date) },
      });
      expect(db.approvalAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          instanceId: 'inst-1',
          round: 1,
          stepOrder: 1,
          action: 'APPROVED',
          actorUserId: 'u-mgr',
          onBehalfOfUserId: null,
          isOverride: false,
          note: 'ok',
        }),
      });
      expect(onFinal).toHaveBeenCalledWith(prisma);
    });

    it('two-step chain: ADVANCED (no onFinal), then APPROVED by the manager\'s manager', async () => {
      const chain = [step(1), step(2, { approverType: 'MANAGERS_MANAGER', name: 'Director' })];
      registry.register(handler());
      db.approvalInstance.findUnique.mockResolvedValueOnce(instance({ steps: chain }));
      const onFinal = jest.fn();

      const first = await act('u-mgr', 'APPROVE', onFinal);
      expect(first).toEqual({ outcome: 'ADVANCED', instanceId: 'inst-1', nextStepOrder: 2 });
      expect(db.approvalInstance.updateMany).toHaveBeenCalledWith({
        where: { id: 'inst-1', status: 'PENDING', currentStepOrder: 1, round: 1 },
        data: { currentStepOrder: 2 },
      });
      expect(onFinal).not.toHaveBeenCalled();

      // The manager cannot act on step 2.
      db.approvalInstance.findUnique.mockResolvedValue(instance({ steps: chain, currentStepOrder: 2 }));
      await expect(act('u-mgr', 'APPROVE', onFinal)).rejects.toThrow(NOT_AN_APPROVER);

      const second = await act('u-dir', 'APPROVE', onFinal);
      expect(second.outcome).toBe('APPROVED');
      expect(onFinal).toHaveBeenCalledTimes(1);
    });

    it('after ADVANCED notifies the next approvers and the requester', async () => {
      const chain = [step(1), step(2, { approverType: 'MANAGERS_MANAGER', name: 'Director' })];
      registry.register(handler());
      db.approvalInstance.findUnique
        .mockResolvedValueOnce(instance({ steps: chain }))
        .mockResolvedValue(instance({ steps: chain, currentStepOrder: 2 }));

      await act('u-mgr');
      await flush();
      await flush();

      expect(notifications.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'u-dir', type: 'APPROVAL_REQUIRED' }),
      ]);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-req', type: 'APPROVAL_STEP_APPROVED', link: '/approvals' }),
      );
    });

    it('reject on any step: REJECTED and onFinal runs', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({ steps: [step(1), step(2, { approverType: 'HR_ADMIN' })] }),
      );
      const onFinal = jest.fn().mockResolvedValue(undefined);

      const result = await act('u-mgr', 'REJECT', onFinal);

      expect(result.outcome).toBe('REJECTED');
      expect(db.approvalInstance.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'REJECTED', completedAt: expect.any(Date) } }),
      );
      expect(db.approvalAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'REJECTED' }),
      });
      expect(onFinal).toHaveBeenCalledWith(prisma);
    });

    it('rejects a non-approver with 403', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance());

      await expect(act('u-other')).rejects.toThrow(new ForbiddenException(NOT_AN_APPROVER));
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('lets HR act through the admin override and records isOverride', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance());

      await act('u-hr');

      expect(db.approvalAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorUserId: 'u-hr', isOverride: true, onBehalfOfUserId: null }),
      });
    });

    it('refuses HR when the chain disables the admin override', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance({ adminOverride: false }));

      await expect(act('u-hr')).rejects.toThrow(NOT_AN_APPROVER);
    });

    it('does not flag an override when HR is an eligible approver anyway', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({ steps: [step(1, { approverType: 'HR_ADMIN' })] }),
      );

      await act('u-hr');

      expect(db.approvalAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ isOverride: false }),
      });
    });

    it('blocks the maker of a payroll run when self-approval is off, even via override', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({
          entityType: 'PAYROLL_RUN',
          entityId: 'run-1',
          steps: [step(1, { approverType: 'HR_ADMIN' })],
          allowSelfApproval: false,
          requesterEmployeeId: null,
          requesterUserId: 'u-hr',
        }),
      );

      await expect(
        engine.act({ tenantId: TENANT, entityType: 'PAYROLL_RUN', entityId: 'run-1', actor: actor('u-hr'), decision: 'APPROVE' }),
      ).rejects.toThrow(new ForbiddenException(PAYROLL_SELF_APPROVAL));
    });

    it('blocks the requester by employee id with the generic message', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({ allowSelfApproval: false, requesterUserId: null, steps: [step(1, { approverType: 'ROLE', approverRole: 'EMPLOYEE' })] }),
      );

      await expect(act('u-req')).rejects.toThrow(new ForbiddenException(SELF_APPROVAL));
    });

    it('allows the requester to approve when self-approval is on', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({ requesterEmployeeId: 'e-hr', requesterUserId: 'u-hr', steps: [step(1, { approverType: 'HR_ADMIN' })] }),
      );

      await expect(act('u-hr')).resolves.toEqual(expect.objectContaining({ outcome: 'APPROVED' }));
    });

    it('lets a delegate of the approver act on their behalf', async () => {
      directory({ delegations: [{ delegatorUserId: 'u-mgr', delegateUserId: 'u-other', entityType: null }] });
      db.approvalInstance.findUnique.mockResolvedValue(instance());

      await act('u-other');

      expect(db.approvalAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorUserId: 'u-other', onBehalfOfUserId: 'u-mgr', isOverride: false }),
      });
    });

    it('ignores a delegation for another request type', async () => {
      directory({ delegations: [{ delegatorUserId: 'u-mgr', delegateUserId: 'u-other', entityType: 'EXPENSE' }] });
      db.approvalInstance.findUnique.mockResolvedValue(instance());

      await expect(act('u-other')).rejects.toThrow(NOT_AN_APPROVER);
    });

    it('lets the approver\'s manager cover while the approver is on leave today', async () => {
      directory({ onLeave: ['e-mgr'] });
      db.approvalInstance.findUnique.mockResolvedValue(instance());

      await act('u-dir');

      expect(db.approvalAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorUserId: 'u-dir', onBehalfOfUserId: 'u-mgr' }),
      });
    });

    it('gives no leave cover when the approver on leave has delegated', async () => {
      directory({
        onLeave: ['e-mgr'],
        delegations: [{ delegatorUserId: 'u-mgr', delegateUserId: 'u-other', entityType: 'LEAVE' }],
      });
      db.approvalInstance.findUnique.mockResolvedValue(instance());

      await expect(act('u-dir')).rejects.toThrow(NOT_AN_APPROVER);
    });

    it('falls back to HR when the requester has no manager', async () => {
      directory({
        users: USERS.map((u) => (u.id === 'u-req' ? { ...u, employee: { ...u.employee, managerId: null } } : u)),
      });
      db.approvalInstance.findUnique.mockResolvedValue(instance());

      await act('u-hr');

      expect(db.approvalAction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ actorUserId: 'u-hr', isOverride: false }),
      });
    });

    it('falls back to HR when the specific user is inactive', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({ steps: [step(1, { approverType: 'SPECIFIC_USER', approverUserId: 'u-gone' })], adminOverride: false }),
      );

      await expect(act('u-hr')).resolves.toEqual(expect.objectContaining({ outcome: 'APPROVED' }));
    });

    it('returns 409 when the guarded update matches no row', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance());
      db.approvalInstance.updateMany.mockResolvedValue({ count: 0 });
      const onFinal = jest.fn();

      await expect(act('u-mgr', 'APPROVE', onFinal)).rejects.toThrow(new ConflictException(ALREADY_ACTIONED));
      expect(db.approvalAction.create).not.toHaveBeenCalled();
      expect(onFinal).not.toHaveBeenCalled();
    });

    it('propagates an onFinal failure (the transaction rolls back)', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance());
      const onFinal = jest.fn().mockRejectedValue(new Error('balance went negative'));

      await expect(act('u-mgr', 'APPROVE', onFinal)).rejects.toThrow('balance went negative');
    });

    it('creates a missing instance lazily from the handler context', async () => {
      const h = handler({
        getContext: jest.fn().mockResolvedValue({ requesterEmployeeId: 'e-req', requesterUserId: 'u-req', days: 2 }),
      });
      registry.register(h);
      db.approvalInstance.findUnique.mockResolvedValue(null);
      db.workflowDefinition.findUnique.mockResolvedValue(null);
      db.approvalInstance.upsert.mockResolvedValue(instance());

      const result = await act('u-mgr');

      expect(h.getContext).toHaveBeenCalledWith(TENANT, 'leave-1');
      expect(db.approvalInstance.upsert).toHaveBeenCalled();
      expect(result.outcome).toBe('APPROVED');
    });

    it('returns 404 when there is no instance and the handler has no context', async () => {
      registry.register(handler());
      db.approvalInstance.findUnique.mockResolvedValue(null);

      await expect(act('u-mgr')).rejects.toThrow(new NotFoundException(NOT_AWAITING));
    });

    it.each(['APPROVED', 'REJECTED', 'CANCELLED'])(
      'returns 409 (not 404) for a %s instance whose entity is no longer awaiting approval',
      async (status) => {
        registry.register(handler());
        db.approvalInstance.findUnique.mockResolvedValue(instance({ status }));

        await expect(act('u-mgr')).rejects.toThrow(new ConflictException(ALREADY_ACTIONED));
        expect(db.approvalInstance.upsert).not.toHaveBeenCalled();
        expect(db.$transaction).not.toHaveBeenCalled();
      },
    );

    it.each(['REJECTED', 'CANCELLED'])(
      'restarts a stale %s instance (round + 1) when the domain still awaits approval, then acts on step 1',
      async (status) => {
        const h = handler({
          getContext: jest.fn().mockResolvedValue({ requesterEmployeeId: 'e-req', requesterUserId: 'u-req', days: 2 }),
        });
        registry.register(h);
        db.approvalInstance.findUnique.mockResolvedValue(
          instance({ status, round: 1, currentStepOrder: 2, steps: [step(1), step(2, { approverType: 'HR_ADMIN' })] }),
        );
        db.workflowDefinition.findUnique.mockResolvedValue(null);
        db.approvalInstance.upsert.mockResolvedValue(instance({ round: 2, currentStepOrder: 1 }));
        const onFinal = jest.fn().mockResolvedValue(undefined);

        const result = await act('u-mgr', 'APPROVE', onFinal);

        expect(h.getContext).toHaveBeenCalledWith(TENANT, 'leave-1');
        expect(db.approvalInstance.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { entityType_entityId: { entityType: 'LEAVE', entityId: 'leave-1' } },
            update: expect.objectContaining({
              round: { increment: 1 },
              currentStepOrder: 1,
              status: 'PENDING',
              completedAt: null,
            }),
          }),
        );
        expect(db.approvalInstance.updateMany).toHaveBeenCalledWith({
          where: { id: 'inst-1', status: 'PENDING', currentStepOrder: 1, round: 2 },
          data: { status: 'APPROVED', completedAt: expect.any(Date) },
        });
        expect(db.approvalAction.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ round: 2, stepOrder: 1, actorUserId: 'u-mgr' }),
        });
        expect(onFinal).toHaveBeenCalledWith(prisma);
        expect(result).toEqual({ outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null });
      },
    );

    it('ignores an instance that belongs to another tenant', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance({ tenantId: 'other-tenant' }));

      await expect(act('u-mgr')).rejects.toThrow(NotFoundException);
    });
  });

  describe('a non-admin requester never acts on their own request', () => {
    const act = (actorId: string, entityType: WorkflowEntityType = 'LEAVE', entityId = 'leave-1') =>
      engine.act({ tenantId: TENANT, entityType, entityId, actor: actor(actorId), decision: 'APPROVE' });

    it('blocks a delegate who is the requester, and keeps it out of their inbox and trail', async () => {
      // The manager delegates to their own report, who raised the request.
      directory({ delegations: [{ delegatorUserId: 'u-mgr', delegateUserId: 'u-req', entityType: null }] });
      registry.register(handler());
      db.approvalInstance.findUnique.mockResolvedValue(instance());
      db.approvalInstance.findMany.mockResolvedValue([instance()]);

      await expect(act('u-req')).rejects.toThrow(new ForbiddenException(SELF_APPROVAL));
      expect(db.$transaction).not.toHaveBeenCalled();
      await expect(engine.listActionableEntityIds(actor('u-req'), 'LEAVE')).resolves.toEqual([]);
      await expect(engine.getInbox(actor('u-req'))).resolves.toEqual([]);
      await expect(engine.getTrail(actor('u-req'), 'LEAVE', 'leave-1')).resolves.toEqual(
        expect.objectContaining({ canAct: false }),
      );
    });

    it('blocks a leave-cover manager who is the requester', async () => {
      // The specific approver (u-mgr) is on leave; their manager (u-dir) raised the request.
      directory({ onLeave: ['e-mgr'] });
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({
          requesterEmployeeId: 'e-dir',
          requesterUserId: 'u-dir',
          steps: [step(1, { approverType: 'SPECIFIC_USER', approverUserId: 'u-mgr' })],
        }),
      );

      await expect(act('u-dir')).rejects.toThrow(new ForbiddenException(SELF_APPROVAL));
    });

    it('blocks a ROLE-step requester even with self-approval on; other role holders still act', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({
          entityType: 'EXPENSE',
          entityId: 'exp-1',
          requesterEmployeeId: 'e-mgr',
          requesterUserId: 'u-mgr',
          allowSelfApproval: true,
          steps: [step(1, { approverType: 'ROLE', approverRole: UserRole.MANAGER })],
        }),
      );

      await expect(act('u-mgr', 'EXPENSE', 'exp-1')).rejects.toThrow(new ForbiddenException(SELF_APPROVAL));
      await expect(act('u-dir', 'EXPENSE', 'exp-1')).resolves.toEqual(
        expect.objectContaining({ outcome: 'APPROVED' }),
      );
    });

    it('blocks a SPECIFIC_USER-step requester even with self-approval on', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({
          entityType: 'EXPENSE',
          entityId: 'exp-1',
          allowSelfApproval: true,
          steps: [step(1, { approverType: 'SPECIFIC_USER', approverUserId: 'u-req' })],
        }),
      );

      await expect(act('u-req', 'EXPENSE', 'exp-1')).rejects.toThrow(new ForbiddenException(SELF_APPROVAL));
    });

    it('lets an HR admin requester act when self-approval is on', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({ requesterEmployeeId: 'e-hr', requesterUserId: 'u-hr', allowSelfApproval: true }),
      );

      await expect(act('u-hr')).resolves.toEqual(expect.objectContaining({ outcome: 'APPROVED' }));
    });

    it('blocks an HR admin requester when self-approval is off', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({
          requesterEmployeeId: 'e-hr',
          requesterUserId: 'u-hr',
          allowSelfApproval: false,
          steps: [step(1, { approverType: 'HR_ADMIN' })],
        }),
      );

      await expect(act('u-hr')).rejects.toThrow(new ForbiddenException(SELF_APPROVAL));
    });

    it('never notifies the requester, even when they are an eligible approver', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({
          requesterEmployeeId: 'e-mgr',
          requesterUserId: 'u-mgr',
          allowSelfApproval: true,
          steps: [step(1, { approverType: 'ROLE', approverRole: UserRole.MANAGER })],
        }),
      );

      await engine.notifyPending(TENANT, 'LEAVE', 'leave-1');

      expect(notifications.createMany).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'u-dir', type: 'APPROVAL_REQUIRED' }),
      ]);
    });

    it('never notifies an admin requester matched only by employee id', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(
        instance({
          requesterEmployeeId: 'e-hr',
          requesterUserId: null,
          allowSelfApproval: true,
          steps: [step(1, { approverType: 'HR_ADMIN' })],
        }),
      );

      await engine.notifyPending(TENANT, 'LEAVE', 'leave-1');

      expect(notifications.createMany).not.toHaveBeenCalled();
    });

    it('does not notify the requester on the ADVANCED path either', async () => {
      const chain = [step(1), step(2, { approverType: 'SPECIFIC_USER', approverUserId: 'u-req', name: 'Self' })];
      registry.register(handler());
      directory({ delegations: [] });
      db.approvalInstance.findUnique
        .mockResolvedValueOnce(instance({ steps: chain }))
        .mockResolvedValue(instance({ steps: chain, currentStepOrder: 2 }));

      await act('u-mgr');
      await flush();
      await flush();

      expect(notifications.createMany).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('marks the PENDING instance cancelled, inside the given transaction', async () => {
      const tx = createMockPrismaService() as any;
      tx.approvalInstance.updateMany.mockResolvedValue({ count: 1 });

      await engine.cancel(TENANT, 'PAYROLL_RUN', 'run-1', tx);

      expect(tx.approvalInstance.updateMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, entityType: 'PAYROLL_RUN', entityId: 'run-1', status: 'PENDING' },
        data: { status: 'CANCELLED', completedAt: expect.any(Date) },
      });
      expect(db.approvalInstance.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listActionableEntityIds / getInbox', () => {
    const pending = [
      instance({ id: 'i-1', entityId: 'leave-1' }),
      instance({ id: 'i-2', entityId: 'leave-2', requesterEmployeeId: 'e-other', requesterUserId: 'u-other' }),
      instance({ id: 'i-3', entityType: 'EXPENSE', entityId: 'exp-1', steps: [step(1), step(2, { approverType: 'MANAGERS_MANAGER' })], currentStepOrder: 2 }),
    ];

    beforeEach(() => {
      db.approvalInstance.findMany.mockResolvedValue(pending);
    });

    it('lists only the entities whose current step the actor may act on', async () => {
      await expect(engine.listActionableEntityIds(actor('u-mgr'), 'LEAVE')).resolves.toEqual(['leave-1']);
      expect(db.approvalInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, status: 'PENDING', entityType: 'LEAVE' },
          take: 500,
        }),
      );
    });

    it('scans every PENDING instance in pages of 500, so older requests are not dropped', async () => {
      // 500 newer requests the manager cannot act on, then theirs on page two.
      const firstPage = Array.from({ length: 500 }, (_, n) =>
        instance({ id: `x-${n}`, entityId: `leave-x-${n}`, requesterEmployeeId: 'e-other', requesterUserId: 'u-other' }),
      );
      const secondPage = [instance({ id: 'i-old', entityId: 'leave-old' })];
      db.approvalInstance.findMany.mockReset();
      db.approvalInstance.findMany
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce(secondPage);

      await expect(engine.listActionableEntityIds(actor('u-mgr'), 'LEAVE')).resolves.toEqual(['leave-old']);

      expect(db.approvalInstance.findMany).toHaveBeenCalledTimes(2);
      const [first, second] = db.approvalInstance.findMany.mock.calls.map((c: any[]) => c[0]);
      expect(first).toEqual({
        where: { tenantId: TENANT, status: 'PENDING', entityType: 'LEAVE' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });
      expect(second).toEqual({
        where: { tenantId: TENANT, status: 'PENDING', entityType: 'LEAVE' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
        cursor: { id: 'x-499' },
        skip: 1,
      });
    });

    it('pages the cross-type inbox scan too', async () => {
      registry.register(handler());
      const firstPage = Array.from({ length: 500 }, (_, n) =>
        instance({ id: `x-${n}`, entityId: `leave-x-${n}`, requesterEmployeeId: 'e-other', requesterUserId: 'u-other' }),
      );
      db.approvalInstance.findMany.mockReset();
      db.approvalInstance.findMany
        .mockResolvedValueOnce(firstPage)
        .mockResolvedValueOnce([instance({ id: 'i-old', entityId: 'leave-old' })]);

      const inbox = await engine.getInbox(actor('u-mgr'));

      expect(inbox.map((i) => i.entityId)).toEqual(['leave-old']);
      expect(db.approvalInstance.findMany.mock.calls[1][0]).toEqual(
        expect.objectContaining({ where: { tenantId: TENANT, status: 'PENDING' }, cursor: { id: 'x-499' } }),
      );
    });

    it('does not list override-only items for HR', async () => {
      db.approvalInstance.findMany.mockResolvedValue([pending[0]]);
      await expect(engine.listActionableEntityIds(actor('u-hr'), 'LEAVE')).resolves.toEqual([]);
    });

    it('builds the cross-type inbox from registered handlers, skipping unregistered types', async () => {
      registry.register(handler());
      const inbox = await engine.getInbox(actor('u-mgr'));

      expect(inbox).toEqual([
        expect.objectContaining({
          instanceId: 'i-1',
          entityType: 'LEAVE',
          entityId: 'leave-1',
          title: 'Casual Leave · 2 days',
          currentStepOrder: 1,
          totalSteps: 1,
          currentStepName: 'Step 1',
          onBehalfOf: null,
        }),
      ]);
    });

    it('shows the manager\'s manager step-2 items, and delegated items with onBehalfOf', async () => {
      registry.register(handler());
      registry.register(handler({ entityType: 'EXPENSE' }));
      directory({ delegations: [{ delegatorUserId: 'u-mgr', delegateUserId: 'u-hr', entityType: null }] });

      const dirInbox = await engine.getInbox(actor('u-dir'));
      expect(dirInbox.map((i) => i.entityId)).toEqual(['exp-1']);

      const hrInbox = await engine.getInbox(actor('u-hr'));
      expect(hrInbox.find((i) => i.entityId === 'leave-1')?.onBehalfOf).toEqual({
        userId: 'u-mgr',
        name: 'Manoj Mgr',
      });
    });
  });

  describe('getTrail', () => {
    const chain = [step(1, { name: 'Manager' }), step(2, { name: 'Director', approverType: 'MANAGERS_MANAGER' })];

    it('shows acted, pending and waiting steps of the current round', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance({ steps: chain, currentStepOrder: 2, round: 2 }));
      db.approvalAction.findMany.mockResolvedValue([
        { round: 1, stepOrder: 1, action: 'REJECTED', actorUserId: 'u-mgr', onBehalfOfUserId: null, isOverride: false, note: 'old', createdAt: new Date('2026-09-18T12:00:00Z') },
        { round: 2, stepOrder: 1, action: 'APPROVED', actorUserId: 'u-other', onBehalfOfUserId: 'u-mgr', isOverride: false, note: 'fine', createdAt: new Date('2026-09-21T12:00:00Z') },
      ]);

      const trail = await engine.getTrail(actor('u-req'), 'LEAVE', 'leave-1');

      expect(trail).toEqual({
        instanceId: 'inst-1',
        status: 'PENDING',
        round: 2,
        currentStepOrder: 2,
        canAct: false,
        steps: [
          {
            order: 1,
            name: 'Manager',
            approverType: 'REPORTING_MANAGER',
            state: 'APPROVED',
            actedBy: { userId: 'u-other', name: 'Omar Other' },
            onBehalfOf: { userId: 'u-mgr', name: 'Manoj Mgr' },
            isOverride: false,
            actedAt: '2026-09-21T12:00:00.000Z',
            note: 'fine',
          },
          expect.objectContaining({ order: 2, state: 'PENDING', actedBy: null }),
        ],
      });
    });

    it('reports canAct for the current approver', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance({ steps: chain, currentStepOrder: 2 }));
      const trail = await engine.getTrail(actor('u-dir'), 'LEAVE', 'leave-1');
      expect(trail.canAct).toBe(true);
      expect(trail.steps[1].state).toBe('PENDING');
    });

    it('marks unreached steps of a rejected request as cancelled', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance({ steps: chain, status: 'REJECTED' }));
      db.approvalAction.findMany.mockResolvedValue([
        { round: 1, stepOrder: 1, action: 'REJECTED', actorUserId: 'u-mgr', onBehalfOfUserId: null, isOverride: false, note: null, createdAt: new Date('2026-09-21T12:00:00Z') },
      ]);
      const trail = await engine.getTrail(actor('u-req'), 'LEAVE', 'leave-1');
      expect(trail.steps.map((s) => s.state)).toEqual(['REJECTED', 'CANCELLED']);
      expect(trail.canAct).toBe(false);
    });

    it('is forbidden to an unrelated employee', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance());
      await expect(engine.getTrail(actor('u-other'), 'LEAVE', 'leave-1')).rejects.toThrow(
        new ForbiddenException(TRAIL_FORBIDDEN),
      );
    });

    it('is visible to HR', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(instance({ adminOverride: false }));
      await expect(engine.getTrail(actor('u-hr'), 'LEAVE', 'leave-1')).resolves.toEqual(
        expect.objectContaining({ canAct: false }),
      );
    });

    it('returns 404 when the entity has no instance', async () => {
      db.approvalInstance.findUnique.mockResolvedValue(null);
      await expect(engine.getTrail(actor('u-hr'), 'LEAVE', 'leave-1')).rejects.toThrow(
        new NotFoundException(NO_APPROVAL),
      );
    });
  });
});
