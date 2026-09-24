import { UserRole } from '@prisma/client';
import { CompOffWorkflowHandler } from './comp-off-workflow.handler';
import { createMockPrismaService } from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

describe('CompOffWorkflowHandler', () => {
  const tenantId = 'test-tenant';
  let prisma: any;
  let registry: { register: jest.Mock };
  let compOffService: { approve: jest.Mock; reject: jest.Mock };
  let handler: CompOffWorkflowHandler;

  const actor: AuthenticatedUser = {
    userId: 'user-hr',
    email: 'hr@test.com',
    tenantId,
    role: UserRole.HR_ADMIN,
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = { register: jest.fn() };
    compOffService = {
      approve: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
    };
    prisma.user.findFirst.mockResolvedValue(null);
    handler = new CompOffWorkflowHandler(prisma, registry as any, compOffService as any);
  });

  it('registers itself for COMP_OFF', () => {
    handler.onModuleInit();
    expect(handler.entityType).toBe('COMP_OFF');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  describe('getContext', () => {
    it('uses earnedDays as the day count for a PENDING request', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue({
        status: 'PENDING',
        employeeId: 'emp-1',
        earnedDays: 0.5,
      });

      expect(await handler.getContext(tenantId, 'co-1')).toEqual({
        requesterEmployeeId: 'emp-1',
        requesterUserId: null,
        days: 0.5,
      });
      expect(prisma.compOffRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'co-1', tenantId } }),
      );
    });

    it('returns null unless the request is PENDING', async () => {
      prisma.compOffRequest.findFirst.mockResolvedValue({
        status: 'APPROVED',
        employeeId: 'emp-1',
        earnedDays: 1,
      });
      expect(await handler.getContext(tenantId, 'co-1')).toBeNull();

      prisma.compOffRequest.findFirst.mockResolvedValue(null);
      expect(await handler.getContext(tenantId, 'co-1')).toBeNull();
    });
  });

  it('describes requests for the inbox', async () => {
    prisma.compOffRequest.findMany.mockResolvedValue([
      {
        id: 'co-1',
        earnedDays: 1,
        workedDate: new Date('2026-10-10T00:00:00Z'),
        createdAt: new Date('2026-10-11T12:00:00Z'),
        employee: { firstName: 'Asha', lastName: 'Rao' },
      },
    ]);

    const [summary] = await handler.describe(tenantId, ['co-1']);

    expect(summary).toEqual(
      expect.objectContaining({
        entityId: 'co-1',
        title: 'Comp-off · 1 day',
        requesterName: 'Asha Rao',
        link: '/approvals/comp-off',
        submittedAt: '2026-10-11T12:00:00.000Z',
      }),
    );
    expect(summary.subtitle).toMatch(/^Worked /);
    expect(await handler.describe(tenantId, [])).toEqual([]);
  });

  it('delegates approve and reject to CompOffService', async () => {
    await handler.approve(actor, 'co-1', 'ok');
    await handler.reject(actor, 'co-1');

    expect(compOffService.approve).toHaveBeenCalledWith(actor, 'co-1', { approverNote: 'ok' });
    expect(compOffService.reject).toHaveBeenCalledWith(actor, 'co-1', {
      approverNote: undefined,
    });
  });
});
