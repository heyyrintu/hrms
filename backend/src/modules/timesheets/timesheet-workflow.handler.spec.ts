import { Prisma, WorkflowEntityType } from '@prisma/client';
import { TimesheetWorkflowHandler } from './timesheet-workflow.handler';
import { createMockPrismaService } from '../../test/helpers';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('TimesheetWorkflowHandler', () => {
  let prisma: any;
  let registry: { register: jest.Mock };
  let timesheets: { approve: jest.Mock; reject: jest.Mock };
  let handler: TimesheetWorkflowHandler;
  const tenantId = 'test-tenant';

  beforeEach(() => {
    prisma = createMockPrismaService();
    registry = { register: jest.fn() };
    timesheets = { approve: jest.fn().mockResolvedValue({}), reject: jest.fn().mockResolvedValue({}) };
    handler = new TimesheetWorkflowHandler(prisma, registry as any, timesheets as any);
  });

  it('is the TIMESHEET handler and registers itself on init', () => {
    expect(handler.entityType).toBe(WorkflowEntityType.TIMESHEET);
    handler.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(handler);
  });

  describe('getContext', () => {
    it('is null for a missing timesheet', async () => {
      prisma.timesheet.findFirst.mockResolvedValue(null);
      await expect(handler.getContext(tenantId, 'ts-1')).resolves.toBeNull();
    });

    it.each(['DRAFT', 'APPROVED', 'REJECTED'])('is null unless SUBMITTED (%s)', async (status) => {
      prisma.timesheet.findFirst.mockResolvedValue({ status, employeeId: 'emp-1' });
      await expect(handler.getContext(tenantId, 'ts-1')).resolves.toBeNull();
    });

    it('returns the requester for a SUBMITTED timesheet', async () => {
      prisma.timesheet.findFirst.mockResolvedValue({ status: 'SUBMITTED', employeeId: 'emp-1' });
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      await expect(handler.getContext(tenantId, 'ts-1')).resolves.toEqual({
        requesterEmployeeId: 'emp-1',
        requesterUserId: 'user-1',
        days: null,
      });
      expect(prisma.timesheet.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ts-1', tenantId } }),
      );
    });
  });

  describe('describe', () => {
    it('is empty for no ids and does not query', async () => {
      await expect(handler.describe(tenantId, [])).resolves.toEqual([]);
      expect(prisma.timesheet.findMany).not.toHaveBeenCalled();
    });

    it('summarises week and hours', async () => {
      prisma.timesheet.findMany.mockResolvedValue([
        {
          id: 'ts-1',
          weekStart: d('2026-03-16'),
          totalHours: new Prisma.Decimal('38.5'),
          submittedAt: new Date('2026-03-20T10:00:00Z'),
          createdAt: new Date('2026-03-16T10:00:00Z'),
          employee: { firstName: 'Asha', lastName: 'Rao' },
        },
      ]);

      const [summary] = await handler.describe(tenantId, ['ts-1']);

      expect(summary).toEqual({
        entityId: 'ts-1',
        title: 'Timesheet',
        subtitle: 'Week of 16 Mar 2026 · 38.5 h',
        requesterName: 'Asha Rao',
        link: '/approvals/timesheets',
        submittedAt: '2026-03-20T10:00:00.000Z',
      });
    });
  });

  it('delegates approve and reject to the service with the note', async () => {
    const actor = { userId: 'u', tenantId, role: 'MANAGER' } as AuthenticatedUser;
    await handler.approve(actor, 'ts-1', 'ok');
    await handler.reject(actor, 'ts-1', null);
    expect(timesheets.approve).toHaveBeenCalledWith(actor, 'ts-1', 'ok');
    expect(timesheets.reject).toHaveBeenCalledWith(actor, 'ts-1', null);
  });
});
