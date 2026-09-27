import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { UserRole } from '@prisma/client';
import { OneTimePaymentsService } from './one-time-payments.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('OneTimePaymentsService', () => {
  let service: OneTimePaymentsService;
  let prisma: any;

  const tenantId = 'tenant-1';
  const actor = { userId: 'user-hr', tenantId, email: 'hr@x.test', role: UserRole.HR_ADMIN };
  const employee = { id: 'emp-1', employeeCode: 'E001', firstName: 'Asha', lastName: 'Rao', status: 'ACTIVE' };
  const regularRun = {
    id: 'run-1', tenantId, month: 10, year: 2026, runType: 'REGULAR', sequence: 0,
    status: 'DRAFT', scopeEmployeeIds: [],
  };
  const row = {
    id: 'otp-1', tenantId, payrollRunId: 'run-1', employeeId: 'emp-1', kind: 'BONUS',
    name: 'Diwali bonus', amount: new Decimal(10000), taxable: true, note: null,
    createdById: 'user-hr', createdAt: new Date('2026-10-15T12:00:00Z'), employee,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OneTimePaymentsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();
    service = module.get(OneTimePaymentsService);
    prisma = module.get(PrismaService);

    prisma.payrollRun.findFirst.mockResolvedValue(regularRun);
    prisma.employee.findFirst.mockResolvedValue(employee);
    prisma.employeeSalary.findFirst.mockResolvedValue({ id: 'es-1' });
    prisma.payrollOneTimePayment.count.mockResolvedValue(0);
    prisma.payrollOneTimePayment.create.mockResolvedValue(row);
    prisma.payrollRun.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('listForRun', () => {
    it('lists the run payments as views, 404 for another tenant run', async () => {
      prisma.payrollOneTimePayment.findMany.mockResolvedValue([row]);
      const views = await service.listForRun(tenantId, 'run-1');
      expect(views).toEqual([
        expect.objectContaining({
          id: 'otp-1', kind: 'BONUS', isEarning: true, amount: 10000, taxable: true,
          employee: { id: 'emp-1', employeeCode: 'E001', firstName: 'Asha', lastName: 'Rao' },
          createdAt: '2026-10-15T12:00:00.000Z',
        }),
      ]);
      expect(prisma.payrollOneTimePayment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, payrollRunId: 'run-1' } }),
      );

      prisma.payrollRun.findFirst.mockResolvedValue(null);
      await expect(service.listForRun(tenantId, 'run-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    const input = { employeeId: 'emp-1', kind: 'BONUS' as const, name: '  Diwali bonus ', amount: 10000 };

    it('adds a payment to a DRAFT run without flagging a recompute', async () => {
      const view = await service.create(actor, 'run-1', input);

      expect(prisma.payrollOneTimePayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId, payrollRunId: 'run-1', employeeId: 'emp-1', kind: 'BONUS',
            name: 'Diwali bonus', taxable: true, createdById: 'user-hr',
          }),
        }),
      );
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'run-1', tenantId, status: 'DRAFT' },
        data: { needsRecompute: false },
      });
      expect(view.id).toBe('otp-1');
    });

    it('flags a COMPUTED run for recompute in the same transaction', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({ ...regularRun, status: 'COMPUTED' });
      await service.create(actor, 'run-1', input);
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'run-1', tenantId, status: 'COMPUTED' },
        data: { needsRecompute: true },
      });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('answers 409 when the run moved on meanwhile', async () => {
      prisma.payrollRun.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.create(actor, 'run-1', input)).rejects.toBeInstanceOf(ConflictException);
    });

    it.each(['APPROVED', 'PAID', 'PROCESSING'])('refuses a %s run', async (status) => {
      prisma.payrollRun.findFirst.mockResolvedValue({ ...regularRun, status });
      await expect(service.create(actor, 'run-1', input)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payrollOneTimePayment.create).not.toHaveBeenCalled();
    });

    it('stores deductions as not taxable whatever was sent', async () => {
      await service.create(actor, 'run-1', { ...input, kind: 'RECOVERY', taxable: true });
      expect(prisma.payrollOneTimePayment.create.mock.calls[0][0].data.taxable).toBe(false);
    });

    it('refuses a regular-run employee who is not active, or has no salary assignment', async () => {
      prisma.employee.findFirst.mockResolvedValue({ ...employee, status: 'INACTIVE' });
      await expect(service.create(actor, 'run-1', input)).rejects.toThrow(/active/i);

      prisma.employee.findFirst.mockResolvedValue(employee);
      prisma.employeeSalary.findFirst.mockResolvedValue(null);
      await expect(service.create(actor, 'run-1', input)).rejects.toThrow(/salary/i);
    });

    it('404s an employee of another tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.create(actor, 'run-1', input)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('requires an off-cycle run employee to be in its scope, not active', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...regularRun, runType: 'OFF_CYCLE', sequence: 1, scopeEmployeeIds: ['emp-2'],
      });
      await expect(service.create(actor, 'run-1', input)).rejects.toThrow(/scope/i);

      prisma.payrollRun.findFirst.mockResolvedValue({
        ...regularRun, runType: 'OFF_CYCLE', sequence: 1, scopeEmployeeIds: ['emp-1'],
      });
      prisma.employee.findFirst.mockResolvedValue({ ...employee, status: 'INACTIVE' });
      await expect(service.create(actor, 'run-1', input)).resolves.toBeDefined();
    });

    it('validates the amount, the name and the per-employee limit', async () => {
      await expect(service.create(actor, 'run-1', { ...input, amount: 0 })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(actor, 'run-1', { ...input, name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(actor, 'run-1', { ...input, name: 'x'.repeat(101) }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.payrollOneTimePayment.count.mockResolvedValue(50);
      await expect(service.create(actor, 'run-1', input)).rejects.toThrow(/50/);
    });
  });

  describe('remove', () => {
    it('deletes from a COMPUTED run and flags the recompute', async () => {
      prisma.payrollOneTimePayment.findFirst.mockResolvedValue({
        ...row, payrollRun: { ...regularRun, status: 'COMPUTED' },
      });
      prisma.payrollOneTimePayment.deleteMany.mockResolvedValue({ count: 1 });

      await service.remove(tenantId, 'otp-1');

      expect(prisma.payrollOneTimePayment.deleteMany).toHaveBeenCalledWith({
        where: { id: 'otp-1', tenantId },
      });
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'run-1', tenantId, status: 'COMPUTED' },
        data: { needsRecompute: true },
      });
    });

    it('refuses once the run is APPROVED or PAID', async () => {
      prisma.payrollOneTimePayment.findFirst.mockResolvedValue({
        ...row, payrollRun: { ...regularRun, status: 'APPROVED' },
      });
      await expect(service.remove(tenantId, 'otp-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.payrollOneTimePayment.deleteMany).not.toHaveBeenCalled();
    });

    it('404s a payment of another tenant', async () => {
      prisma.payrollOneTimePayment.findFirst.mockResolvedValue(null);
      await expect(service.remove(tenantId, 'otp-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
