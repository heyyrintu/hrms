import { ExpenseWorkflowHandler } from './expense-workflow.handler';
import { createMockPrismaService } from '../../test/helpers';

describe('ExpenseWorkflowHandler', () => {
  const tenantId = 'tenant-1';
  const actor = { userId: 'user-mgr', tenantId, email: 'm@test.com', role: 'MANAGER' } as any;

  let prisma: any;
  let registry: { register: jest.Mock };
  let expenses: { getWorkflowContext: jest.Mock; approveClaim: jest.Mock; rejectClaim: jest.Mock };
  let handler: ExpenseWorkflowHandler;

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = { register: jest.fn() };
    expenses = {
      getWorkflowContext: jest.fn(),
      approveClaim: jest.fn().mockResolvedValue({ id: 'claim-1' }),
      rejectClaim: jest.fn().mockResolvedValue({ id: 'claim-1' }),
    };
    handler = new ExpenseWorkflowHandler(prisma, registry as any, expenses as any);
  });

  it('registers itself for EXPENSE on module init', () => {
    handler.onModuleInit();

    expect(handler.entityType).toBe('EXPENSE');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('delegates getContext to the service', async () => {
    const context = { requesterEmployeeId: 'emp-1', requesterUserId: 'user-1', amount: 500 };
    expenses.getWorkflowContext.mockResolvedValue(context);

    await expect(handler.getContext(tenantId, 'claim-1')).resolves.toEqual(context);
    expect(expenses.getWorkflowContext).toHaveBeenCalledWith(tenantId, 'claim-1');
  });

  it('describes claims tenant-scoped, linking to /approvals/expenses', async () => {
    prisma.expenseClaim.findMany.mockResolvedValue([
      {
        id: 'claim-1',
        amount: '1500.00',
        description: 'Client dinner',
        status: 'SUBMITTED',
        createdAt: new Date('2026-09-20T12:00:00Z'),
        updatedAt: new Date('2026-09-21T12:00:00Z'),
        category: { name: 'Meals' },
        employee: { firstName: 'Asha', lastName: 'Rao' },
      },
    ]);

    const [summary] = await handler.describe(tenantId, ['claim-1', 'gone']);

    expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: { in: ['claim-1', 'gone'] } } }),
    );
    expect(summary).toEqual({
      entityId: 'claim-1',
      title: expect.stringContaining('Meals'),
      subtitle: 'Client dinner',
      requesterName: 'Asha Rao',
      link: '/approvals/expenses',
      submittedAt: '2026-09-21T12:00:00.000Z',
    });
  });

  it('skips the query for an empty id list', async () => {
    await expect(handler.describe(tenantId, [])).resolves.toEqual([]);
    expect(prisma.expenseClaim.findMany).not.toHaveBeenCalled();
  });

  it('approve / reject delegate to the service with the note as approverNote', async () => {
    await handler.approve(actor, 'claim-1', 'ok');
    await handler.reject(actor, 'claim-1', null);

    expect(expenses.approveClaim).toHaveBeenCalledWith(actor, 'claim-1', { approverNote: 'ok' });
    expect(expenses.rejectClaim).toHaveBeenCalledWith(actor, 'claim-1', {
      approverNote: undefined,
    });
  });
});
