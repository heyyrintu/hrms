import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RequisitionsService } from './requisitions.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { createMockPrismaService, mockHrAdmin, mockManager } from '../../test/helpers';

describe('RequisitionsService', () => {
  let service: RequisitionsService;
  let prisma: any;
  let workflow: { start: jest.Mock; act: jest.Mock; cancel: jest.Mock; notifyPending: jest.Mock };
  let notifications: { create: jest.Mock };

  const tenantId = mockHrAdmin.tenantId;

  const baseRow = {
    id: 'req-1',
    tenantId,
    title: 'Backend Engineer',
    departmentId: null,
    designationId: null,
    hiringManagerId: null,
    headcount: 2,
    employmentType: 'PERMANENT',
    budgetMin: null,
    budgetMax: '1200000',
    justification: null,
    status: 'DRAFT',
    requestedById: mockManager.userId,
    requesterEmployeeId: mockManager.employeeId,
    submittedAt: null,
    decidedAt: null,
    decisionNote: null,
    filledCount: 0,
    createdAt: new Date('2026-01-01T12:00:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z'),
    department: null,
    designation: null,
    hiringManager: null,
    _count: { openings: 0 },
  };

  beforeEach(async () => {
    workflow = { start: jest.fn(), act: jest.fn(), cancel: jest.fn(), notifyPending: jest.fn() };
    notifications = { create: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequisitionsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: ApprovalEngineService, useValue: workflow },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(RequisitionsService);
    prisma = module.get(PrismaService);
    prisma.user.findFirst.mockResolvedValue({ email: 'manager@test.com', employee: null });
  });

  describe('list', () => {
    it('scopes a manager to their own requisitions', async () => {
      prisma.jobRequisition.findMany.mockResolvedValue([baseRow]);

      await service.list(mockManager, {});

      expect(prisma.jobRequisition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, requestedById: mockManager.userId },
        }),
      );
    });

    it('lets HR see every requisition', async () => {
      prisma.jobRequisition.findMany.mockResolvedValue([baseRow]);

      await service.list(mockHrAdmin, {});

      expect(prisma.jobRequisition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId } }),
      );
    });
  });

  describe('get', () => {
    it("403s a manager viewing another requester's requisition", async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, requestedById: 'someone-else' });

      await expect(service.get(mockManager, 'req-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s when the requisition does not exist in the tenant', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue(null);

      await expect(service.get(mockHrAdmin, 'req-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('validates a department id belongs to the tenant', async () => {
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockManager, { title: 'Engineer', headcount: 1, departmentId: 'foreign-dept' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a DRAFT requisition owned by the actor', async () => {
      prisma.jobRequisition.create.mockResolvedValue(baseRow);

      await service.create(mockManager, { title: 'Backend Engineer', headcount: 2, budgetMax: 1200000 });

      expect(prisma.jobRequisition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            status: 'DRAFT',
            requestedById: mockManager.userId,
            requesterEmployeeId: mockManager.employeeId,
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('refuses to edit an APPROVED requisition', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, status: 'APPROVED' });

      await expect(service.update(mockManager, 'req-1', { title: 'New title' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('submit', () => {
    it('starts the approval instance with budgetMax * headcount as the amount', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue(baseRow);
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
      prisma.jobRequisition.update.mockResolvedValue({ ...baseRow, status: 'PENDING_APPROVAL' });

      await service.submit(mockManager, 'req-1');

      expect(workflow.start).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'JOB_REQUISITION',
          entityId: 'req-1',
          context: {
            requesterEmployeeId: mockManager.employeeId,
            requesterUserId: mockManager.userId,
            amount: 2400000,
          },
        }),
      );
    });

    it('refuses to submit a PENDING_APPROVAL requisition again', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, status: 'PENDING_APPROVAL' });

      await expect(service.submit(mockManager, 'req-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('restarts approval from REJECTED (ADVANCED keeps PENDING_APPROVAL)', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, status: 'REJECTED' });
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
      prisma.jobRequisition.update.mockResolvedValue({ ...baseRow, status: 'PENDING_APPROVAL' });

      const result = await service.submit(mockManager, 'req-1');

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(workflow.start).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING_APPROVAL requisition and withdraws the approval instance', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, status: 'PENDING_APPROVAL' });
      prisma.$transaction.mockImplementation(async (cb: any) => cb(prisma));
      prisma.jobRequisition.update.mockResolvedValue({ ...baseRow, status: 'CANCELLED' });

      await service.cancel(mockManager, 'req-1');

      expect(workflow.cancel).toHaveBeenCalledWith(tenantId, 'JOB_REQUISITION', 'req-1', prisma);
    });

    it('refuses to cancel an APPROVED requisition', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, status: 'APPROVED' });

      await expect(service.cancel(mockManager, 'req-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('approve / reject', () => {
    it('approve on the final step sets APPROVED and notifies the requester', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue(baseRow);
      workflow.act.mockImplementation(async (input: any) => {
        await input.onFinal(prisma);
        return { outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null };
      });
      prisma.jobRequisition.update.mockResolvedValue({ ...baseRow, status: 'APPROVED' });

      const result = await service.approve(mockHrAdmin, 'req-1', 'looks good');

      expect(result.status).toBe('APPROVED');
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: baseRow.requestedById,
          type: 'REQUISITION_APPROVED',
        }),
      );
    });

    it('reject sets REJECTED and notifies the requester', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue(baseRow);
      workflow.act.mockImplementation(async (input: any) => {
        await input.onFinal(prisma);
        return { outcome: 'REJECTED', instanceId: 'inst-1', nextStepOrder: null };
      });
      prisma.jobRequisition.update.mockResolvedValue({ ...baseRow, status: 'REJECTED' });

      const result = await service.reject(mockHrAdmin, 'req-1', 'not now');

      expect(result.status).toBe('REJECTED');
      expect(notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'REQUISITION_REJECTED' }),
      );
    });

    it('an ADVANCED outcome (multi-step chain) leaves status PENDING_APPROVAL and skips notification', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, status: 'PENDING_APPROVAL' });
      workflow.act.mockResolvedValue({ outcome: 'ADVANCED', instanceId: 'inst-1', nextStepOrder: 2 });

      const result = await service.approve(mockHrAdmin, 'req-1');

      expect(result.status).toBe('PENDING_APPROVAL');
      expect(notifications.create).not.toHaveBeenCalled();
    });
  });

  describe('getWorkflowContext', () => {
    it('returns null when the requisition is not PENDING_APPROVAL', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue(null);

      await expect(service.getWorkflowContext(tenantId, 'req-1')).resolves.toBeNull();
    });

    it('returns the routing context when PENDING_APPROVAL', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({
        requesterEmployeeId: 'emp-1',
        requestedById: 'user-1',
        budgetMax: '500000',
        headcount: 3,
      });

      await expect(service.getWorkflowContext(tenantId, 'req-1')).resolves.toEqual({
        requesterEmployeeId: 'emp-1',
        requesterUserId: 'user-1',
        amount: 1500000,
      });
    });
  });

  describe('recordHire', () => {
    it('increments filledCount and sets FILLED at headcount', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, headcount: 1, filledCount: 0 });

      await service.recordHire(tenantId, 'req-1');

      expect(prisma.jobRequisition.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { filledCount: 1, status: 'FILLED' },
      });
    });

    it('increments without changing status when below headcount', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue({ ...baseRow, headcount: 3, filledCount: 0 });

      await service.recordHire(tenantId, 'req-1');

      expect(prisma.jobRequisition.update).toHaveBeenCalledWith({
        where: { id: 'req-1' },
        data: { filledCount: 1 },
      });
    });

    it('is a no-op when the requisition no longer exists', async () => {
      prisma.jobRequisition.findFirst.mockResolvedValue(null);

      await service.recordHire(tenantId, 'req-1');

      expect(prisma.jobRequisition.update).not.toHaveBeenCalled();
    });
  });
});
