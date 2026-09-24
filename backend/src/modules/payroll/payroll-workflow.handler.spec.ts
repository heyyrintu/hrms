import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PAYROLL_NOT_REJECTED, PayrollWorkflowHandler } from './payroll-workflow.handler';
import { createMockPrismaService } from '../../test/helpers';

describe('PayrollWorkflowHandler', () => {
  const tenantId = 'tenant-1';
  const actor = { userId: 'user-checker', tenantId, email: 'c@test.com', role: 'HR_ADMIN' } as any;

  let prisma: any;
  let registry: { register: jest.Mock };
  let payroll: { getWorkflowContext: jest.Mock; approveRun: jest.Mock };
  let handler: PayrollWorkflowHandler;

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = { register: jest.fn() };
    payroll = {
      getWorkflowContext: jest.fn(),
      approveRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'APPROVED' }),
    };
    handler = new PayrollWorkflowHandler(prisma, registry as any, payroll as any);
  });

  it('registers itself for PAYROLL_RUN on module init', () => {
    handler.onModuleInit();

    expect(handler.entityType).toBe('PAYROLL_RUN');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  it('delegates getContext (null unless COMPUTED) to the service', async () => {
    payroll.getWorkflowContext.mockResolvedValue(null);

    await expect(handler.getContext(tenantId, 'run-1')).resolves.toBeNull();
    expect(payroll.getWorkflowContext).toHaveBeenCalledWith(tenantId, 'run-1');
  });

  it('describes a run as "Payroll <Month> <year>" with net and headcount, naming the maker', async () => {
    prisma.payrollRun.findMany.mockResolvedValue([
      {
        id: 'run-1',
        month: 9,
        year: 2026,
        totalNet: new Decimal('1000000.25'),
        processedCount: 25,
        processedById: 'user-maker',
        processedAt: new Date('2026-09-28T12:00:00Z'),
        updatedAt: new Date('2026-09-28T12:05:00Z'),
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'user-maker', email: 'maker@test.com', employee: { firstName: 'Ravi', lastName: 'K' } },
    ]);

    const [summary] = await handler.describe(tenantId, ['run-1']);

    expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: { in: ['run-1'] } } }),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: { in: ['user-maker'] } } }),
    );
    expect(summary).toEqual({
      entityId: 'run-1',
      title: 'Payroll September 2026',
      subtitle: `₹${(1000000.25).toLocaleString('en-IN')} net · 25 employees`,
      requesterName: 'Ravi K',
      link: '/payroll',
      submittedAt: '2026-09-28T12:00:00.000Z',
    });
  });

  it('describes a legacy run (no maker) without a user lookup', async () => {
    prisma.payrollRun.findMany.mockResolvedValue([
      {
        id: 'run-0',
        month: 1,
        year: 2026,
        totalNet: 10,
        processedCount: 1,
        processedById: null,
        processedAt: null,
        updatedAt: new Date('2026-01-31T12:00:00Z'),
      },
    ]);

    const [summary] = await handler.describe(tenantId, ['run-0']);

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(summary.title).toBe('Payroll January 2026');
    expect(summary.requesterName).toBeNull();
    expect(summary.submittedAt).toBe('2026-01-31T12:00:00.000Z');
  });

  it('approve delegates to PayrollService.approveRun with the actor', async () => {
    await handler.approve(actor, 'run-1', 'checked');

    expect(payroll.approveRun).toHaveBeenCalledWith(tenantId, 'run-1', actor, 'checked');
  });

  it('reject is a 400: runs are reset, not rejected', async () => {
    await expect(handler.reject()).rejects.toThrow(BadRequestException);
    await expect(handler.reject()).rejects.toThrow(PAYROLL_NOT_REJECTED);
    expect(PAYROLL_NOT_REJECTED).toBe('Payroll runs are not rejected; reset the run instead');
  });
});
