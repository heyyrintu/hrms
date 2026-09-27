import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma, UserRole } from '@prisma/client';
import { SalaryHoldsService } from './salary-holds.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';
import { NotificationsService } from '../../notifications/notifications.service';

describe('SalaryHoldsService', () => {
  let service: SalaryHoldsService;
  let prisma: any;
  let notifications: { notifyEmployee: jest.Mock };

  const tenantId = 'tenant-1';
  const actor = { userId: 'user-hr', tenantId, email: 'hr@x.test', role: UserRole.HR_ADMIN };
  const employee = { id: 'emp-1', employeeCode: 'E001', firstName: 'Asha', lastName: 'Rao', status: 'ACTIVE' };
  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-3', tenantId, month: 3, year: 2026, runType: 'REGULAR', sequence: 0,
    status: 'APPROVED', scopeEmployeeIds: [], ...overrides,
  });
  const holdRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'hold-1', tenantId, employeeId: 'emp-1', payrollRunId: 'run-3', reason: 'Absconding',
    status: 'HELD', heldAmount: null, releaseRunId: null, releasedAt: null, voidedAt: null,
    voidReason: null, createdAt: new Date('2026-03-28T12:00:00Z'),
    employee, payrollRun: run(), releaseRun: null, ...overrides,
  });

  beforeEach(async () => {
    notifications = { notifyEmployee: jest.fn().mockResolvedValue(null) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryHoldsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(SalaryHoldsService);
    prisma = module.get(PrismaService);

    prisma.employee.findFirst.mockResolvedValue(employee);
    prisma.payslip.findFirst.mockResolvedValue({ id: 'slip-1', netPay: new Decimal(52000) });
    prisma.salaryHold.create.mockResolvedValue(holdRow());
    prisma.salaryHold.updateMany.mockResolvedValue({ count: 1 });
    prisma.salaryHold.deleteMany.mockResolvedValue({ count: 1 });
    prisma.payrollRun.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('hold', () => {
    it.each(['DRAFT', 'COMPUTED', 'APPROVED'])('holds an employee in a %s run and tells them, without amounts', async (status) => {
      prisma.payrollRun.findFirst.mockResolvedValue(run({ status }));

      const view = await service.hold(actor, 'run-3', { employeeId: 'emp-1', reason: '  Absconding ' });

      expect(prisma.salaryHold.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            tenantId, employeeId: 'emp-1', payrollRunId: 'run-3', reason: 'Absconding',
            status: 'HELD', createdById: 'user-hr',
          },
        }),
      );
      expect(view.status).toBe('HELD');
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId, 'emp-1', 'SALARY_HELD', expect.any(String), expect.not.stringMatching(/52000|₹|Rs/), expect.any(String),
      );
    });

    it.each(['PAID', 'PROCESSING'])('refuses a %s run', async (status) => {
      prisma.payrollRun.findFirst.mockResolvedValue(run({ status }));
      await expect(
        service.hold(actor, 'run-3', { employeeId: 'emp-1', reason: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('needs a payslip in a computed run, the scope in an off-cycle run', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(run({ status: 'COMPUTED' }));
      prisma.payslip.findFirst.mockResolvedValue(null);
      await expect(
        service.hold(actor, 'run-3', { employeeId: 'emp-1', reason: 'x' }),
      ).rejects.toThrow(/payslip/i);

      prisma.payrollRun.findFirst.mockResolvedValue(
        run({ status: 'DRAFT', runType: 'OFF_CYCLE', sequence: 1, scopeEmployeeIds: ['emp-2'] }),
      );
      await expect(
        service.hold(actor, 'run-3', { employeeId: 'emp-1', reason: 'x' }),
      ).rejects.toThrow(/scope/i);
    });

    it('409s a second hold of the same employee in the run', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(run({ status: 'DRAFT' }));
      prisma.salaryHold.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' }),
      );
      await expect(
        service.hold(actor, 'run-3', { employeeId: 'emp-1', reason: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s a run or employee of another tenant', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);
      await expect(service.hold(actor, 'run-x', { employeeId: 'emp-1', reason: 'x' })).rejects.toBeInstanceOf(NotFoundException);
      prisma.payrollRun.findFirst.mockResolvedValue(run({ status: 'DRAFT' }));
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.hold(actor, 'run-3', { employeeId: 'emp-x', reason: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unhold', () => {
    it('removes a HELD hold of an unpaid run', async () => {
      prisma.salaryHold.findFirst.mockResolvedValue(holdRow());
      await service.unhold(tenantId, 'hold-1');
      expect(prisma.salaryHold.deleteMany).toHaveBeenCalledWith({
        where: { id: 'hold-1', tenantId, status: 'HELD' },
      });
    });

    it('refuses a released hold, or a paid run', async () => {
      prisma.salaryHold.findFirst.mockResolvedValue(holdRow({ status: 'RELEASED' }));
      await expect(service.unhold(tenantId, 'hold-1')).rejects.toBeInstanceOf(BadRequestException);
      prisma.salaryHold.findFirst.mockResolvedValue(holdRow({ payrollRun: run({ status: 'PAID' }) }));
      await expect(service.unhold(tenantId, 'hold-1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('release', () => {
    const target = run({ id: 'run-5', month: 5, status: 'COMPUTED' });

    beforeEach(() => {
      prisma.salaryHold.findFirst
        .mockResolvedValueOnce(holdRow())
        .mockResolvedValueOnce(holdRow({ status: 'RELEASED', releaseRun: target, heldAmount: new Decimal(52000) }));
      prisma.payrollRun.findFirst.mockResolvedValue(target);
    });

    it("releases the held payslip's net into a later run and flags a computed target for recompute", async () => {
      const view = await service.release(actor, 'hold-1', 'run-5');

      expect(prisma.salaryHold.updateMany).toHaveBeenCalledWith({
        where: { id: 'hold-1', tenantId, status: 'HELD' },
        data: expect.objectContaining({
          status: 'RELEASED', releaseRunId: 'run-5', releasedById: 'user-hr',
          heldAmount: new Decimal(52000), releasedAt: expect.any(Date),
        }),
      });
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'run-5', tenantId, status: 'COMPUTED' },
        data: { needsRecompute: true },
      });
      expect(prisma.payslip.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, payrollRunId: 'run-3', employeeId: 'emp-1' } }),
      );
      expect(view.status).toBe('RELEASED');
      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId, 'emp-1', 'SALARY_RELEASED', expect.any(String), expect.any(String), expect.any(String),
      );
    });

    it('refuses while the held run is not yet approved', async () => {
      prisma.salaryHold.findFirst.mockReset();
      prisma.salaryHold.findFirst.mockResolvedValue(holdRow({ payrollRun: run({ status: 'COMPUTED' }) }));
      await expect(service.release(actor, 'hold-1', 'run-5')).rejects.toThrow(/approved/i);
    });

    it('refuses the same run, an approved target, or an earlier month', async () => {
      prisma.salaryHold.findFirst.mockReset();
      prisma.salaryHold.findFirst.mockResolvedValue(holdRow());

      prisma.payrollRun.findFirst.mockResolvedValue(run());
      await expect(service.release(actor, 'hold-1', 'run-3')).rejects.toBeInstanceOf(BadRequestException);

      prisma.payrollRun.findFirst.mockResolvedValue({ ...target, status: 'APPROVED' });
      await expect(service.release(actor, 'hold-1', 'run-5')).rejects.toBeInstanceOf(BadRequestException);

      prisma.payrollRun.findFirst.mockResolvedValue({ ...target, month: 2 });
      await expect(service.release(actor, 'hold-1', 'run-5')).rejects.toThrow(/earlier/i);
    });

    it('lets a leaver be paid through an off-cycle run that has them in scope', async () => {
      prisma.employee.findFirst.mockResolvedValue({ ...employee, status: 'INACTIVE' });
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...target, runType: 'OFF_CYCLE', sequence: 1, scopeEmployeeIds: ['emp-1'], status: 'DRAFT',
      });
      await service.release(actor, 'hold-1', 'run-5');
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'run-5', tenantId, status: 'DRAFT' },
        data: { needsRecompute: false },
      });
    });

    it('refuses an inactive employee in a regular target run', async () => {
      prisma.employee.findFirst.mockResolvedValue({ ...employee, status: 'INACTIVE' });
      await expect(service.release(actor, 'hold-1', 'run-5')).rejects.toThrow(/active/i);
    });

    it('409s a lost race on the hold', async () => {
      prisma.salaryHold.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.release(actor, 'hold-1', 'run-5')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('void', () => {
    it('voids a HELD hold of an approved run, freezing the amount never paid', async () => {
      prisma.salaryHold.findFirst
        .mockResolvedValueOnce(holdRow())
        .mockResolvedValueOnce(holdRow({ status: 'VOIDED', voidReason: 'Absconded' }));

      const view = await service.void(actor, 'hold-1', ' Absconded ');

      expect(prisma.salaryHold.updateMany).toHaveBeenCalledWith({
        where: { id: 'hold-1', tenantId, status: 'HELD' },
        data: expect.objectContaining({
          status: 'VOIDED', voidReason: 'Absconded', voidedById: 'user-hr',
          heldAmount: new Decimal(52000), voidedAt: expect.any(Date),
        }),
      });
      expect(view.status).toBe('VOIDED');
    });

    it('refuses a hold that is not HELD', async () => {
      prisma.salaryHold.findFirst.mockResolvedValue(holdRow({ status: 'RELEASED' }));
      await expect(service.void(actor, 'hold-1', 'x')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('run helpers', () => {
    it('reads the releases paid by a run, and detaches them back to HELD', async () => {
      prisma.salaryHold.findMany.mockResolvedValue([]);
      await service.releasesForRun(tenantId, 'run-5');
      expect(prisma.salaryHold.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, releaseRunId: 'run-5', status: 'RELEASED' } }),
      );

      await service.detachReleases(prisma, tenantId, 'run-5');
      expect(prisma.salaryHold.updateMany).toHaveBeenCalledWith({
        where: { tenantId, releaseRunId: 'run-5', status: 'RELEASED' },
        data: { status: 'HELD', releaseRunId: null, releasedAt: null, releasedById: null, heldAmount: null },
      });
    });
  });
});
