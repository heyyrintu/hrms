import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PayrollReimbursementsService } from './payroll-reimbursements.service';
import { PayrollSettingsService } from './payroll-settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';
import { NotificationsService } from '../../notifications/notifications.service';

describe('PayrollReimbursementsService', () => {
  let service: PayrollReimbursementsService;
  let prisma: any;
  let settings: { get: jest.Mock };
  let notifications: { notifyEmployee: jest.Mock };

  const tenantId = 'tenant-1';
  const employee = { id: 'emp-1', employeeCode: 'E001', firstName: 'Asha', lastName: 'Rao' };
  const claim = (id: string, payrollRunId: string | null, amount = 1200) => ({
    id, employeeId: 'emp-1', amount: new Decimal(amount), payrollRunId,
    expenseDate: new Date('2026-09-10T12:00:00Z'), approvedAt: new Date('2026-09-12T12:00:00Z'),
    employee, category: { name: 'Travel' },
  });

  beforeEach(async () => {
    settings = { get: jest.fn().mockResolvedValue({ reimburseExpensesViaPayroll: true, autoArrears: true }) };
    notifications = { notifyEmployee: jest.fn().mockResolvedValue(null) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollReimbursementsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: PayrollSettingsService, useValue: settings },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(PayrollReimbursementsService);
    prisma = module.get(PrismaService);
  });

  describe('getForRun', () => {
    it('lists attached claims and, for a run still open, the eligible ones', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-10', status: 'COMPUTED', runType: 'REGULAR', scopeEmployeeIds: [],
      });
      prisma.expenseClaim.findMany
        .mockResolvedValueOnce([claim('cl-1', 'run-10')])
        .mockResolvedValueOnce([claim('cl-2', null, 800)]);

      const view = await service.getForRun(tenantId, 'run-10');

      expect(view.enabled).toBe(true);
      expect(view.claims).toEqual([
        expect.objectContaining({ id: 'cl-1', attached: true, amount: 1200, categoryName: 'Travel' }),
        expect.objectContaining({ id: 'cl-2', attached: false, amount: 800 }),
      ]);
      expect(view.total).toBe(2000);
      expect(prisma.expenseClaim.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            tenantId, status: 'APPROVED', payrollRunId: null, employee: { status: 'ACTIVE' },
          },
        }),
      );
    });

    it('shows nothing eligible when the setting is off, and 404s another tenant run', async () => {
      settings.get.mockResolvedValue({ reimburseExpensesViaPayroll: false, autoArrears: true });
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-10', status: 'DRAFT', runType: 'OFF_CYCLE', scopeEmployeeIds: ['emp-1'],
      });
      prisma.expenseClaim.findMany.mockResolvedValue([]);
      const view = await service.getForRun(tenantId, 'run-10');
      expect(view).toEqual({ enabled: false, claims: [], total: 0 });
      expect(prisma.expenseClaim.findMany).toHaveBeenCalledTimes(1);

      prisma.payrollRun.findFirst.mockResolvedValue(null);
      await expect(service.getForRun(tenantId, 'run-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('run helpers', () => {
    it('reads APPROVED claims of the run employees that are unattached or already in the run', async () => {
      prisma.expenseClaim.findMany.mockResolvedValue([]);
      await service.claimsForRun(tenantId, 'run-10', ['emp-1']);
      expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId, employeeId: { in: ['emp-1'] }, status: 'APPROVED',
            OR: [{ payrollRunId: null }, { payrollRunId: 'run-10' }],
          },
        }),
      );
    });

    it('attaches with a guarded update and 409s when a claim was taken', async () => {
      prisma.expenseClaim.updateMany.mockResolvedValue({ count: 2 });
      await service.attachToRun(prisma, tenantId, 'run-10', ['cl-1', 'cl-2']);
      expect(prisma.expenseClaim.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['cl-1', 'cl-2'] }, tenantId, status: 'APPROVED', payrollRunId: null },
        data: { payrollRunId: 'run-10' },
      });
      prisma.expenseClaim.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        service.attachToRun(prisma, tenantId, 'run-10', ['cl-1', 'cl-2']),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('detaches, and settles to REIMBURSED at the run payment date', async () => {
      await service.detachFromRun(prisma, tenantId, 'run-10');
      expect(prisma.expenseClaim.updateMany).toHaveBeenCalledWith({
        where: { tenantId, payrollRunId: 'run-10', status: 'APPROVED' },
        data: { payrollRunId: null },
      });

      const paidAt = new Date('2026-10-31T12:00:00Z');
      prisma.expenseClaim.findMany.mockResolvedValue([{ id: 'cl-1', employeeId: 'emp-1', amount: new Decimal(1200) }]);
      const settled = await service.settleForRun(prisma, tenantId, 'run-10', paidAt);
      expect(prisma.expenseClaim.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['cl-1'] }, tenantId, payrollRunId: 'run-10', status: 'APPROVED' },
        data: { status: 'REIMBURSED', reimbursedAt: paidAt },
      });
      expect(settled).toHaveLength(1);

      service.notifyReimbursed(tenantId, settled);
      await new Promise((r) => setImmediate(r));
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId, 'emp-1', 'EXPENSE_REIMBURSED', 'Expense Reimbursed', expect.any(String), '/expenses',
      );
    });
  });
});
