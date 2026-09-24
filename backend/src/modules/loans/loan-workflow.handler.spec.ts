import { LoanWorkflowHandler } from './loan-workflow.handler';
import { createMockPrismaService } from '../../test/helpers';

describe('LoanWorkflowHandler', () => {
  const tenantId = 'tenant-1';
  const actor = { userId: 'user-hr', tenantId, email: 'hr@test.com', role: 'HR_ADMIN' } as any;

  let prisma: any;
  let registry: { register: jest.Mock };
  let loans: { getWorkflowContext: jest.Mock; approve: jest.Mock; reject: jest.Mock };
  let handler: LoanWorkflowHandler;

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = { register: jest.fn() };
    loans = {
      getWorkflowContext: jest.fn(),
      approve: jest.fn().mockResolvedValue({ id: 'loan-1' }),
      reject: jest.fn().mockResolvedValue({ id: 'loan-1' }),
    };
    handler = new LoanWorkflowHandler(prisma, registry as any, loans as any);
  });

  it('registers itself for LOAN on module init', () => {
    handler.onModuleInit();

    expect(handler.entityType).toBe('LOAN');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('delegates getContext to the service', async () => {
    loans.getWorkflowContext.mockResolvedValue(null);

    await expect(handler.getContext(tenantId, 'loan-1')).resolves.toBeNull();
    expect(loans.getWorkflowContext).toHaveBeenCalledWith(tenantId, 'loan-1');
  });

  it('describes loans tenant-scoped, linking to /approvals/loans', async () => {
    prisma.employeeLoan.findMany.mockResolvedValue([
      {
        id: 'loan-1',
        type: 'SALARY_ADVANCE',
        principal: '20000.00',
        tenureMonths: 2,
        emiAmount: '10000.00',
        createdAt: new Date('2026-09-20T12:00:00Z'),
        employee: { firstName: 'Asha', lastName: 'Rao' },
      },
    ]);

    const [summary] = await handler.describe(tenantId, ['loan-1']);

    expect(prisma.employeeLoan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: { in: ['loan-1'] } } }),
    );
    expect(summary).toMatchObject({
      entityId: 'loan-1',
      requesterName: 'Asha Rao',
      link: '/approvals/loans',
      submittedAt: '2026-09-20T12:00:00.000Z',
    });
    expect(summary.title).toContain('Salary advance');
    expect(summary.subtitle).toContain('2 months');
  });

  it('approve delegates to LoansService.approve with the note', async () => {
    await handler.approve(actor, 'loan-1', 'fine');

    expect(loans.approve).toHaveBeenCalledWith(actor, 'loan-1', 'fine');
  });

  it('reject passes the note as the employee-facing reason', async () => {
    await handler.reject(actor, 'loan-1', 'Existing loan open');
    await handler.reject(actor, 'loan-1', null);

    expect(loans.reject).toHaveBeenNthCalledWith(1, actor, 'loan-1', {
      reason: 'Existing loan open',
    });
    // Blank: the service answers 400, the reason being mandatory.
    expect(loans.reject).toHaveBeenNthCalledWith(2, actor, 'loan-1', { reason: '' });
  });
});
