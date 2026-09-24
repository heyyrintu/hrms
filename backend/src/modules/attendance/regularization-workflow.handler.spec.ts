import { UserRole } from '@prisma/client';
import { RegularizationWorkflowHandler } from './regularization-workflow.handler';
import { createMockPrismaService } from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

describe('RegularizationWorkflowHandler', () => {
  const tenantId = 'test-tenant';
  let prisma: any;
  let registry: { register: jest.Mock };
  let regularizationService: {
    approve: jest.Mock;
    reject: jest.Mock;
    resolveRequesterUserId: jest.Mock;
  };
  let handler: RegularizationWorkflowHandler;

  const actor: AuthenticatedUser = {
    userId: 'user-mgr',
    email: 'm@test.com',
    tenantId,
    role: UserRole.MANAGER,
    employeeId: 'emp-mgr',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = { register: jest.fn() };
    regularizationService = {
      approve: jest.fn().mockResolvedValue({}),
      reject: jest.fn().mockResolvedValue({}),
      resolveRequesterUserId: jest.fn().mockResolvedValue('user-emp'),
    };
    handler = new RegularizationWorkflowHandler(
      prisma,
      registry as any,
      regularizationService as any,
    );
  });

  it('registers itself for REGULARIZATION', () => {
    handler.onModuleInit();
    expect(handler.entityType).toBe('REGULARIZATION');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  describe('getContext', () => {
    it('returns the requester with no day count for a PENDING request', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue({
        status: 'PENDING',
        employeeId: 'emp-1',
      });

      expect(await handler.getContext(tenantId, 'reg-1')).toEqual({
        requesterEmployeeId: 'emp-1',
        requesterUserId: 'user-emp',
        days: null,
      });
      expect(regularizationService.resolveRequesterUserId).toHaveBeenCalledWith(tenantId, 'emp-1');
    });

    it('returns null unless the request is PENDING', async () => {
      prisma.attendanceRegularization.findFirst.mockResolvedValue({
        status: 'REJECTED',
        employeeId: 'emp-1',
      });
      expect(await handler.getContext(tenantId, 'reg-1')).toBeNull();

      prisma.attendanceRegularization.findFirst.mockResolvedValue(null);
      expect(await handler.getContext(tenantId, 'reg-1')).toBeNull();
    });
  });

  it('describes requests for the inbox', async () => {
    prisma.attendanceRegularization.findMany.mockResolvedValue([
      {
        id: 'reg-1',
        date: new Date('2026-10-12T00:00:00Z'),
        createdAt: new Date('2026-10-13T12:00:00Z'),
        employee: { firstName: 'Asha', lastName: 'Rao' },
      },
    ]);

    const [summary] = await handler.describe(tenantId, ['reg-1']);

    expect(prisma.attendanceRegularization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId, id: { in: ['reg-1'] } } }),
    );
    expect(summary).toEqual(
      expect.objectContaining({
        entityId: 'reg-1',
        title: 'Attendance regularization',
        requesterName: 'Asha Rao',
        link: '/approvals/regularization',
        submittedAt: '2026-10-13T12:00:00.000Z',
      }),
    );
    expect(summary.subtitle).toContain('2026');
    expect(await handler.describe(tenantId, [])).toEqual([]);
  });

  it('delegates approve and reject to RegularizationService', async () => {
    await handler.approve(actor, 'reg-1', 'ok');
    await handler.reject(actor, 'reg-1', 'no');

    expect(regularizationService.approve).toHaveBeenCalledWith(actor, 'reg-1', {
      approverNote: 'ok',
    });
    expect(regularizationService.reject).toHaveBeenCalledWith(actor, 'reg-1', {
      approverNote: 'no',
    });
  });
});
