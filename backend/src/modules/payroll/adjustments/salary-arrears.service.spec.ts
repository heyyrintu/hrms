import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { SalaryArrearsService } from './salary-arrears.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';
import { PayrollCalculationService } from '../payroll-calculation.service';

describe('SalaryArrearsService', () => {
  let service: SalaryArrearsService;
  let prisma: any;
  let calc: { calculateRegularEarnings: jest.Mock };

  const tenantId = 'tenant-1';
  const employeeId = 'emp-1';
  const employee = { id: employeeId, employeeCode: 'E001', firstName: 'Asha', lastName: 'Rao' };

  /** A payslip paid for a month before the revision was entered. */
  function paid(month: number, basic: number, hra: number, id = `slip-${month}`) {
    return {
      id,
      basePay: new Decimal(basic),
      earnings: [{ name: 'HRA', amount: hra }],
      createdAt: new Date(Date.UTC(2026, month - 1, 25, 12)),
      payrollRun: { month, year: 2026 },
    };
  }

  /** calculateRegularEarnings answer for the revised salary. */
  function revised(basic: number, hra: number, employeeSalaryId = 'es-2') {
    return {
      employeeSalaryId,
      basePay: new Decimal(basic),
      earnings: [{ name: 'HRA', amount: new Decimal(hra) }],
      total: new Decimal(basic + hra),
      pfWages: new Decimal(basic),
      pfApplicableNames: [],
    };
  }

  /** Entered on 5 October, effective from 1 August. */
  const revision = {
    id: 'es-2',
    effectiveFrom: new Date('2026-08-01T00:00:00Z'),
    effectiveTo: null,
    createdAt: new Date('2026-10-05T12:00:00Z'),
    updatedAt: new Date('2026-10-05T12:00:00Z'),
  };

  beforeEach(async () => {
    calc = { calculateRegularEarnings: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryArrearsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: PayrollCalculationService, useValue: calc },
      ],
    }).compile();
    service = module.get(SalaryArrearsService);
    prisma = module.get(PrismaService);

    prisma.employee.findFirst.mockResolvedValue({ id: employeeId });
    prisma.employeeSalary.findMany.mockResolvedValue([revision]);
    prisma.salaryArrear.findMany.mockResolvedValue([]);
    prisma.salaryArrear.create.mockImplementation(async ({ data }: any) => ({
      id: `ar-${data.forMonth}`,
      ...data,
      status: 'PENDING',
      payrollRunId: null,
      createdAt: new Date('2026-10-06T12:00:00Z'),
      employee,
      payrollRun: null,
    }));
  });

  describe('detectForEmployee', () => {
    it('writes one arrear per paid month a backdated revision changes', async () => {
      // July, August and September were paid; the revision starts in August.
      prisma.payslip.findMany.mockResolvedValue([paid(7, 40000, 16000), paid(8, 40000, 16000), paid(9, 40000, 16000)]);
      calc.calculateRegularEarnings.mockResolvedValue(revised(44000, 17600));

      const result = await service.detectForEmployee(tenantId, employeeId);

      expect(result.created).toBe(2);
      expect(calc.calculateRegularEarnings).toHaveBeenCalledTimes(2);
      expect(calc.calculateRegularEarnings).toHaveBeenCalledWith(tenantId, employeeId, 8, 2026, 'es-2');
      expect(calc.calculateRegularEarnings).toHaveBeenCalledWith(tenantId, employeeId, 9, 2026, 'es-2');

      const data = prisma.salaryArrear.create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          tenantId, employeeId, employeeSalaryId: 'es-2', forMonth: 8, forYear: 2026,
          financialYear: 2026, originalPayslipId: 'slip-8',
        }),
      );
      expect(data.originalAmount.toString()).toBe('56000');
      expect(data.revisedAmount.toString()).toBe('61600');
      expect(data.amount.toString()).toBe('5600');
      // Basic is always PF wages.
      expect(data.pfWagesDelta.toString()).toBe('4000');
      expect(data.lines).toEqual([
        { name: 'Basic', original: 40000, revised: 44000, delta: 4000 },
        { name: 'HRA', original: 16000, revised: 17600, delta: 1600 },
      ]);
      expect(result.arrears[0]).toEqual(
        expect.objectContaining({ forMonth: 8, amount: 5600, status: 'PENDING', payrollRun: null }),
      );
    });

    it('looks at salary payslips of approved or paid runs of this tenant, not voided ones', async () => {
      prisma.payslip.findMany.mockResolvedValue([paid(8, 40000, 16000)]);
      calc.calculateRegularEarnings.mockResolvedValue(revised(40000, 16000));
      await service.detectForEmployee(tenantId, employeeId);
      // Review (minor): a month paid by an off-cycle run with salary counts;
      // a month whose salary was held and then voided was never paid.
      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            employeeId,
            payrollRun: {
              status: { in: ['APPROVED', 'PAID'] },
              OR: [{ runType: 'REGULAR' }, { runType: 'OFF_CYCLE', includeSalary: true }],
              holds: { none: { employeeId, status: 'VOIDED' } },
            },
          },
        }),
      );
      expect(prisma.employeeSalary.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId, employeeId, isActive: true }) }),
      );
    });

    it('is idempotent: a month that already has an arrear for the revision is left alone', async () => {
      prisma.payslip.findMany.mockResolvedValue([paid(8, 40000, 16000), paid(9, 40000, 16000)]);
      prisma.salaryArrear.findMany.mockResolvedValue([
        { id: 'ar-8', employeeSalaryId: 'es-2', forMonth: 8, forYear: 2026, amount: new Decimal(5600), status: 'INCLUDED', lines: [] },
        // Cancelled by HR on purpose: not resurrected either.
        { id: 'ar-9', employeeSalaryId: 'es-2', forMonth: 9, forYear: 2026, amount: new Decimal(5600), status: 'CANCELLED', lines: [] },
      ]);

      const result = await service.detectForEmployee(tenantId, employeeId);

      expect(result.created).toBe(0);
      expect(calc.calculateRegularEarnings).not.toHaveBeenCalled();
      expect(prisma.salaryArrear.create).not.toHaveBeenCalled();
    });

    it('adds only the remaining difference when a second revision covers months that already carry arrears', async () => {
      prisma.employeeSalary.findMany.mockResolvedValue([
        { ...revision, id: 'es-3', createdAt: new Date('2026-11-02T12:00:00Z'), updatedAt: new Date('2026-11-02T12:00:00Z') },
      ]);
      prisma.payslip.findMany.mockResolvedValue([paid(8, 40000, 16000)]);
      // The first revision already added 5,600 for August.
      prisma.salaryArrear.findMany.mockResolvedValue([
        {
          id: 'ar-8', employeeSalaryId: 'es-2', forMonth: 8, forYear: 2026, amount: new Decimal(5600), status: 'PAID',
          lines: [
            { name: 'Basic', original: 40000, revised: 44000, delta: 4000 },
            { name: 'HRA', original: 16000, revised: 17600, delta: 1600 },
          ],
        },
      ]);
      calc.calculateRegularEarnings.mockResolvedValue(revised(46000, 18400, 'es-3'));

      await service.detectForEmployee(tenantId, employeeId);

      const data = prisma.salaryArrear.create.mock.calls[0][0].data;
      expect(data.employeeSalaryId).toBe('es-3');
      expect(data.originalAmount.toString()).toBe('61600');
      expect(data.amount.toString()).toBe('2800');
      expect(data.lines).toEqual([
        { name: 'Basic', original: 44000, revised: 46000, delta: 2000 },
        { name: 'HRA', original: 17600, revised: 18400, delta: 800 },
      ]);
    });

    it('records a downward revision as a negative arrear (a recovery)', async () => {
      prisma.payslip.findMany.mockResolvedValue([paid(8, 40000, 16000)]);
      calc.calculateRegularEarnings.mockResolvedValue(revised(38000, 15200));

      await service.detectForEmployee(tenantId, employeeId);

      const data = prisma.salaryArrear.create.mock.calls[0][0].data;
      expect(data.amount.toString()).toBe('-2800');
      expect(data.pfWagesDelta.toString()).toBe('-2000');
    });

    it('writes nothing for a month the revision does not change', async () => {
      prisma.payslip.findMany.mockResolvedValue([paid(8, 40000, 16000)]);
      calc.calculateRegularEarnings.mockResolvedValue(revised(40000, 16000));
      const result = await service.detectForEmployee(tenantId, employeeId);
      expect(result.created).toBe(0);
      expect(prisma.salaryArrear.create).not.toHaveBeenCalled();
    });

    it('ignores months computed after the revision was entered (they already used it)', async () => {
      const recomputed = { ...paid(9, 44000, 17600), createdAt: new Date('2026-10-20T12:00:00Z') };
      prisma.payslip.findMany.mockResolvedValue([recomputed]);
      await service.detectForEmployee(tenantId, employeeId);
      expect(calc.calculateRegularEarnings).not.toHaveBeenCalled();
    });

    it('does nothing for an employee never paid by an approved regular run', async () => {
      prisma.payslip.findMany.mockResolvedValue([]);
      await expect(service.detectForEmployee(tenantId, employeeId)).resolves.toEqual({ created: 0, arrears: [] });
    });

    it('404s an employee of another tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);
      await expect(service.detectForEmployee(tenantId, 'emp-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('treats a concurrent detection of the same month as already done', async () => {
      prisma.payslip.findMany.mockResolvedValue([paid(8, 40000, 16000)]);
      calc.calculateRegularEarnings.mockResolvedValue(revised(44000, 17600));
      prisma.salaryArrear.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.detectForEmployee(tenantId, employeeId)).resolves.toEqual({ created: 0, arrears: [] });
    });
  });

  describe('list', () => {
    it('filters by status and employee within the tenant', async () => {
      prisma.salaryArrear.findMany.mockResolvedValue([]);
      await service.list(tenantId, { status: 'PENDING', employeeId });
      expect(prisma.salaryArrear.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId, status: 'PENDING', employeeId } }),
      );
    });
  });

  describe('cancel', () => {
    const pending = {
      id: 'ar-8', tenantId, employeeId, employeeSalaryId: 'es-2', forMonth: 8, forYear: 2026,
      financialYear: 2026, originalAmount: new Decimal(56000), revisedAmount: new Decimal(61600),
      amount: new Decimal(5600), pfWagesDelta: new Decimal(4000), lines: [], status: 'PENDING',
      payrollRunId: null, createdAt: new Date('2026-10-06T12:00:00Z'), employee, payrollRun: null,
    };

    it('cancels a PENDING arrear with a guarded update', async () => {
      prisma.salaryArrear.findFirst
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce({ ...pending, status: 'CANCELLED' });
      prisma.salaryArrear.updateMany.mockResolvedValue({ count: 1 });

      const view = await service.cancel(tenantId, 'ar-8');

      expect(prisma.salaryArrear.updateMany).toHaveBeenCalledWith({
        where: { id: 'ar-8', tenantId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      expect(view.status).toBe('CANCELLED');
    });

    it('refuses anything but PENDING, and 409s a lost race', async () => {
      prisma.salaryArrear.findFirst.mockResolvedValue({ ...pending, status: 'INCLUDED' });
      await expect(service.cancel(tenantId, 'ar-8')).rejects.toBeInstanceOf(BadRequestException);

      prisma.salaryArrear.findFirst.mockResolvedValue(pending);
      prisma.salaryArrear.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.cancel(tenantId, 'ar-8')).rejects.toBeInstanceOf(ConflictException);

      prisma.salaryArrear.findFirst.mockResolvedValue(null);
      await expect(service.cancel(tenantId, 'ar-x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('run helpers', () => {
    const run = { id: 'run-10', month: 10, year: 2026 };

    it('finds arrears for months before the run that are pending or already in it', async () => {
      prisma.salaryArrear.findMany.mockResolvedValue([]);
      await service.pendingForRun(tenantId, run, ['emp-1']);
      expect(prisma.salaryArrear.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            employeeId: { in: ['emp-1'] },
            OR: [
              { status: 'PENDING', payrollRunId: null },
              { status: 'INCLUDED', payrollRunId: 'run-10' },
            ],
            AND: [{ OR: [{ forYear: { lt: 2026 } }, { forYear: 2026, forMonth: { lt: 10 } }] }],
          },
        }),
      );
    });

    it('attaches with a guarded update and 409s when another run took one first', async () => {
      prisma.salaryArrear.updateMany.mockResolvedValue({ count: 2 });
      await service.attachToRun(prisma, tenantId, 'run-10', ['ar-1', 'ar-2']);
      expect(prisma.salaryArrear.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['ar-1', 'ar-2'] }, tenantId, status: 'PENDING', payrollRunId: null },
        data: { status: 'INCLUDED', payrollRunId: 'run-10' },
      });

      prisma.salaryArrear.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        service.attachToRun(prisma, tenantId, 'run-10', ['ar-1', 'ar-2']),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('detaches back to PENDING and settles to PAID', async () => {
      await service.detachFromRun(prisma, tenantId, 'run-10');
      expect(prisma.salaryArrear.updateMany).toHaveBeenCalledWith({
        where: { tenantId, payrollRunId: 'run-10', status: 'INCLUDED' },
        data: { status: 'PENDING', payrollRunId: null },
      });
      await service.markPaidForRun(prisma, tenantId, 'run-10');
      expect(prisma.salaryArrear.updateMany).toHaveBeenCalledWith({
        where: { tenantId, payrollRunId: 'run-10', status: 'INCLUDED' },
        data: { status: 'PAID' },
      });
    });
  });
});
