import { UserRole } from '@prisma/client';
import { LeaveWorkflowHandler, formatDateRange } from './leave-workflow.handler';
import { createMockPrismaService } from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

describe('LeaveWorkflowHandler', () => {
  const tenantId = 'test-tenant';
  let prisma: any;
  let registry: { register: jest.Mock };
  let leaveService: {
    approveRequest: jest.Mock;
    rejectRequest: jest.Mock;
  };
  let handler: LeaveWorkflowHandler;

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
    leaveService = {
      approveRequest: jest.fn().mockResolvedValue({ id: 'req-1' }),
      rejectRequest: jest.fn().mockResolvedValue({ id: 'req-1' }),
    };
    prisma.user.findFirst.mockResolvedValue({ id: 'user-emp' });
    handler = new LeaveWorkflowHandler(prisma, registry as any, leaveService as any);
  });

  it('registers itself for LEAVE on module init', () => {
    handler.onModuleInit();
    expect(handler.entityType).toBe('LEAVE');
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  describe('getContext', () => {
    it('returns the requester and day count for a PENDING request', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue({
        status: 'PENDING',
        employeeId: 'emp-1',
        totalDays: 2.5,
      });

      const ctx = await handler.getContext(tenantId, 'req-1');

      expect(prisma.leaveRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'req-1', tenantId } }),
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { tenantId, employeeId: 'emp-1' },
        select: { id: true },
      });
      expect(ctx).toEqual({ requesterEmployeeId: 'emp-1', requesterUserId: 'user-emp', days: 2.5 });
    });

    it.each(['APPROVED', 'REJECTED', 'CANCELLED'])('returns null for a %s request', async (status) => {
      prisma.leaveRequest.findFirst.mockResolvedValue({ status, employeeId: 'emp-1', totalDays: 1 });
      expect(await handler.getContext(tenantId, 'req-1')).toBeNull();
    });

    it('returns null when the request does not exist in the tenant', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue(null);
      expect(await handler.getContext(tenantId, 'missing')).toBeNull();
    });
  });

  describe('describe', () => {
    it('summarises each request for the inbox', async () => {
      prisma.leaveRequest.findMany.mockResolvedValue([
        {
          id: 'req-1',
          totalDays: 3,
          startDate: new Date('2026-10-12T00:00:00Z'),
          endDate: new Date('2026-10-14T00:00:00Z'),
          createdAt: new Date('2026-10-01T12:00:00Z'),
          leaveType: { name: 'Casual Leave' },
          employee: { firstName: 'Asha', lastName: 'Rao' },
        },
      ]);

      const [summary] = await handler.describe(tenantId, ['req-1', 'gone']);

      expect(prisma.leaveRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, id: { in: ['req-1', 'gone'] } } }),
      );
      expect(summary).toEqual({
        entityId: 'req-1',
        title: 'Casual Leave · 3 days',
        subtitle: formatDateRange(
          new Date('2026-10-12T00:00:00Z'),
          new Date('2026-10-14T00:00:00Z'),
        ),
        requesterName: 'Asha Rao',
        link: '/approvals/leave',
        submittedAt: '2026-10-01T12:00:00.000Z',
      });
    });

    it('does not query for an empty id list', async () => {
      expect(await handler.describe(tenantId, [])).toEqual([]);
      expect(prisma.leaveRequest.findMany).not.toHaveBeenCalled();
    });
  });

  it('formats a single-day range as one date', () => {
    const d = new Date('2026-10-12T00:00:00Z');
    expect(formatDateRange(d, d)).not.toContain('–');
    expect(formatDateRange(d, new Date('2026-10-14T00:00:00Z'))).toContain('–');
  });

  it('delegates approve and reject to LeaveService', async () => {
    await handler.approve(actor, 'req-1', 'fine');
    await handler.reject(actor, 'req-2', null);

    expect(leaveService.approveRequest).toHaveBeenCalledWith(actor, 'req-1', {
      approverNote: 'fine',
    });
    expect(leaveService.rejectRequest).toHaveBeenCalledWith(actor, 'req-2', {
      approverNote: undefined,
    });
  });
});
