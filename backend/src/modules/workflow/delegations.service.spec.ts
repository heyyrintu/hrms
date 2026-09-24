import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createMockPrismaService, mockEmployee, mockHrAdmin, mockManager } from '../../test/helpers';
import { DelegationsService } from './delegations.service';

describe('DelegationsService', () => {
  let db: any;
  let service: DelegationsService;
  const tenantId = mockManager.tenantId;

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: 'del-1',
    tenantId,
    delegatorUserId: mockManager.userId,
    delegateUserId: mockEmployee.userId,
    entityType: null,
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: new Date('2099-12-31T00:00:00Z'),
    reason: 'Holiday',
    isActive: true,
    createdById: mockManager.userId,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z'),
    ...overrides,
  });

  beforeEach(() => {
    db = createMockPrismaService();
    service = new DelegationsService(db);
    db.user.findMany.mockImplementation(async (args: any) =>
      (args.where.id.in as string[]).map((id) => ({ id, email: `${id}@x.com`, role: 'EMPLOYEE', employee: null })),
    );
    db.approvalDelegation.create.mockImplementation(async (args: any) => row(args.data));
  });

  describe('create', () => {
    const dto = {
      delegateUserId: mockEmployee.userId,
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      entityType: 'LEAVE' as const,
      reason: 'On leave',
    };

    it('creates a delegation from the actor, dates as UTC midnight', async () => {
      const view = await service.create(mockManager, dto);

      expect(db.approvalDelegation.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          delegatorUserId: mockManager.userId,
          delegateUserId: mockEmployee.userId,
          entityType: 'LEAVE',
          startDate: new Date('2026-10-01T00:00:00Z'),
          endDate: new Date('2026-10-07T00:00:00Z'),
          reason: 'On leave',
          isActive: true,
          createdById: mockManager.userId,
        },
      });
      expect(view).toEqual(
        expect.objectContaining({
          startDate: '2026-10-01',
          endDate: '2026-10-07',
          delegator: { userId: mockManager.userId, name: `${mockManager.userId}@x.com` },
        }),
      );
    });

    it('rejects delegating to yourself', async () => {
      await expect(
        service.create(mockManager, { ...dto, delegateUserId: mockManager.userId }),
      ).rejects.toThrow('You cannot delegate approvals to yourself');
    });

    it('rejects an end date before the start date', async () => {
      await expect(
        service.create(mockManager, { ...dto, startDate: '2026-10-07', endDate: '2026-10-01' }),
      ).rejects.toThrow('endDate must be on or after startDate');
    });

    it('accepts a one-day delegation', async () => {
      await expect(
        service.create(mockManager, { ...dto, endDate: '2026-10-01' }),
      ).resolves.toBeDefined();
    });

    it('rejects an invalid calendar date', async () => {
      await expect(
        service.create(mockManager, { ...dto, startDate: '2026-02-30' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an inactive or unknown delegate', async () => {
      db.user.findMany.mockResolvedValue([{ id: mockManager.userId }]);
      await expect(service.create(mockManager, dto)).rejects.toThrow(
        'The delegate must be an active user in this organisation',
      );
    });

    it('lets HR create a delegation for someone else', async () => {
      await service.create(mockHrAdmin, { ...dto, delegatorUserId: mockManager.userId });
      expect(db.approvalDelegation.create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ delegatorUserId: mockManager.userId, createdById: mockHrAdmin.userId }),
      );
    });

    it('forbids a non-admin from delegating on behalf of someone else', async () => {
      await expect(
        service.create(mockEmployee, { ...dto, delegateUserId: 'u-x', delegatorUserId: mockManager.userId }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      db.approvalDelegation.update.mockImplementation(async (args: any) => row({ ...args.data }));
    });

    it('lets the delegator cancel', async () => {
      db.approvalDelegation.findFirst.mockResolvedValue(row());
      const view = await service.cancel(mockManager, 'del-1');
      expect(db.approvalDelegation.update).toHaveBeenCalledWith({
        where: { id: 'del-1' },
        data: { isActive: false },
      });
      expect(view.isActive).toBe(false);
      expect(view.isCurrent).toBe(false);
    });

    it('lets HR cancel', async () => {
      db.approvalDelegation.findFirst.mockResolvedValue(row());
      await expect(service.cancel(mockHrAdmin, 'del-1')).resolves.toBeDefined();
    });

    it('forbids the delegate (or anyone else) from cancelling', async () => {
      db.approvalDelegation.findFirst.mockResolvedValue(row());
      await expect(service.cancel(mockEmployee, 'del-1')).rejects.toThrow(ForbiddenException);
      expect(db.approvalDelegation.update).not.toHaveBeenCalled();
    });

    it('returns 404 for a delegation outside the tenant', async () => {
      db.approvalDelegation.findFirst.mockResolvedValue(null);
      await expect(service.cancel(mockManager, 'del-1')).rejects.toThrow(NotFoundException);
      expect(db.approvalDelegation.findFirst).toHaveBeenCalledWith({
        where: { id: 'del-1', tenantId },
      });
    });
  });

  describe('list', () => {
    beforeEach(() => {
      db.approvalDelegation.findMany.mockResolvedValue([row()]);
    });

    it('lists what the actor gave and received', async () => {
      const result = await service.list(mockManager);
      expect(db.approvalDelegation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, delegatorUserId: mockManager.userId } }),
      );
      expect(db.approvalDelegation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, delegateUserId: mockManager.userId } }),
      );
      expect(result.given[0]).toEqual(expect.objectContaining({ id: 'del-1', isCurrent: true }));
    });

    it('lets HR list the whole tenant with all=true', async () => {
      await service.list(mockHrAdmin, true);
      expect(db.approvalDelegation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
    });

    it('ignores all=true for a non-admin', async () => {
      await service.list(mockEmployee, true);
      expect(db.approvalDelegation.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
    });
  });

  describe('searchUsers', () => {
    it('searches active tenant users by name or email, max 20', async () => {
      db.user.findMany.mockResolvedValue([
        { id: 'u-1', email: 'asha@x.com', role: 'MANAGER', employee: { firstName: 'Asha', lastName: 'K' } },
        { id: 'u-2', email: 'svc@x.com', role: 'HR_ADMIN', employee: null },
      ]);

      const result = await service.searchUsers(tenantId, ' as ');

      expect(db.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId, isActive: true, OR: expect.any(Array) }),
          take: 20,
        }),
      );
      expect(result).toEqual([
        { id: 'u-1', name: 'Asha K', email: 'asha@x.com', role: 'MANAGER' },
        { id: 'u-2', name: 'svc@x.com', email: 'svc@x.com', role: 'HR_ADMIN' },
      ]);
    });
  });
});
