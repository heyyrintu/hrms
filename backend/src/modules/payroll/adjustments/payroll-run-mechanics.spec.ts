import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma, PayrollRunStatus } from '@prisma/client';
import { PayrollService } from '../payroll.service';
import { PayrollCalculationService } from '../payroll-calculation.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';
import { LoansService } from '../../loans/loans.service';
import { PayslipEmailService } from '../payslip-email.service';
import { WebhookDispatcherService } from '../../webhooks/webhook-dispatcher.service';
import { ApprovalEngineService } from '../../workflow/approval-engine.service';
import { createRunInputMocks } from './run-inputs.testing';

/** Keka wave C (spec C1-C6): PayrollService run mechanics. */
describe('PayrollService — run mechanics (Keka wave C)', () => {
  let service: PayrollService;
  let prisma: any;
  let calc: { calculateForEmployee: jest.Mock };
  let loans: Record<string, jest.Mock>;
  let engine: Record<string, jest.Mock>;
  let inputs: ReturnType<typeof createRunInputMocks>;

  const tenantId = 'tenant-1';
  const makerId = 'user-maker';
  const zero = () => new Decimal(0);

  function slip(employeeId: string, net = 50000) {
    return {
      employeeId, workingDays: 22, presentDays: 22, leaveDays: 0, lopDays: 0,
      otHours: zero(), basePay: new Decimal(net), earnings: [], deductions: [],
      grossPay: new Decimal(net), totalDeductions: zero(), netPay: new Decimal(net), otPay: zero(),
      nonRecurringTaxable: zero(), nonTaxableEarnings: zero(), arrearsAmount: zero(), reimbursementAmount: zero(),
      statutory: {
        pfWages: zero(), pfEmployee: zero(), pfEmployer: zero(), epsEmployer: zero(), edliEmployer: zero(),
        pfAdminEmployer: zero(), esiWages: zero(), esiEmployee: zero(), esiEmployer: zero(),
        professionalTax: zero(), lwfEmployee: zero(), lwfEmployer: zero(), tds: zero(),
        taxComputation: null, totalEmployeeDeductions: zero(),
      },
      loanRepayments: [],
    };
  }

  const regularDraft = {
    id: 'run-10', tenantId, month: 10, year: 2026, status: 'DRAFT', runType: 'REGULAR',
    sequence: 0, includeSalary: false, scopeEmployeeIds: [], needsRecompute: false,
  };
  const offCycleDraft = {
    ...regularDraft, id: 'run-oc', runType: 'OFF_CYCLE', sequence: 1,
    scopeEmployeeIds: ['emp-1', 'emp-2'], offCycleReason: 'Bonus',
  };

  beforeEach(async () => {
    calc = { calculateForEmployee: jest.fn().mockImplementation(async (_t, id) => slip(id)) };
    loans = {
      clearPayrollRepayments: jest.fn().mockResolvedValue(undefined),
      recordPayrollRepayments: jest.fn().mockResolvedValue([]),
      notifyLoansClosed: jest.fn().mockResolvedValue(undefined),
    };
    engine = {
      start: jest.fn().mockResolvedValue({ id: 'inst-1' }),
      notifyPending: jest.fn().mockResolvedValue(undefined),
      act: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
    };
    inputs = createRunInputMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: PayrollCalculationService, useValue: calc },
        { provide: LoansService, useValue: loans },
        { provide: PayslipEmailService, useValue: { notifyRunApproved: jest.fn().mockResolvedValue(undefined) } },
        { provide: WebhookDispatcherService, useValue: { dispatch: jest.fn().mockResolvedValue(undefined) } },
        { provide: ApprovalEngineService, useValue: engine },
        ...inputs.providers,
      ],
    }).compile();

    service = module.get(PayrollService);
    prisma = module.get(PrismaService);
    engine.act.mockImplementation(async (input: any) => {
      await input.onFinal?.(prisma);
      return { outcome: 'APPROVED', instanceId: 'inst-1', nextStepOrder: null };
    });
    prisma.payrollRun.update.mockResolvedValue({ id: 'run-10', status: 'COMPUTED' });
    prisma.payrollRun.updateMany.mockResolvedValue({ count: 1 });
    prisma.payslip.findMany.mockResolvedValue([]);
    prisma.settlement.findMany.mockResolvedValue([]);
  });

  // ------------------------------------------------------------------ create

  describe('createOffCycleRun', () => {
    const dto = { month: 10, year: 2026, reason: ' Diwali bonus ', includeSalary: false, employeeIds: ['emp-1', 'emp-2', 'emp-1'] };

    it("numbers the run after the month's last off-cycle run", async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
      prisma.payrollRun.findFirst.mockResolvedValue({ sequence: 2 });
      prisma.payrollRun.create.mockImplementation(async ({ data }: any) => ({ id: 'run-oc', ...data }));

      const run = await service.createOffCycleRun(tenantId, dto);

      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: { tenantId, id: { in: ['emp-1', 'emp-2'] }, status: { in: ['ACTIVE', 'INACTIVE'] } },
        select: { id: true },
      });
      expect(prisma.payrollRun.create).toHaveBeenCalledWith({
        data: {
          tenantId, month: 10, year: 2026, runType: 'OFF_CYCLE', sequence: 3,
          offCycleReason: 'Diwali bonus', includeSalary: false, scopeEmployeeIds: ['emp-1', 'emp-2'],
        },
      });
      expect(run.status).toBeUndefined(); // DRAFT by schema default
    });

    it('refuses employees of another tenant', async () => {
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }]);
      await expect(service.createOffCycleRun(tenantId, dto)).rejects.toThrow(/emp-2/);
    });

    it('retries once on a sequence clash, then answers 409', async () => {
      const clash = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't' });
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
      prisma.payrollRun.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ sequence: 1 });
      prisma.payrollRun.create.mockRejectedValueOnce(clash).mockResolvedValueOnce({ id: 'run-oc', sequence: 2 });

      await expect(service.createOffCycleRun(tenantId, dto)).resolves.toEqual({ id: 'run-oc', sequence: 2 });
      expect(prisma.payrollRun.create.mock.calls[1][0].data.sequence).toBe(2);

      prisma.payrollRun.findFirst.mockResolvedValue(null);
      prisma.payrollRun.create.mockRejectedValue(clash);
      await expect(service.createOffCycleRun(tenantId, dto)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ---------------------------------------------------------------- regular

  describe('processing a regular run', () => {
    beforeEach(() => {
      prisma.payrollRun.findFirst.mockResolvedValue(regularDraft);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
    });

    it('detects arrears first, passes each employee its extras and attaches what was paid', async () => {
      inputs.arrears.pendingForRun.mockResolvedValue([
        { id: 'ar-1', employeeId: 'emp-1', amount: new Decimal(5000), pfWagesDelta: new Decimal(4000), financialYear: 2026 },
      ]);
      inputs.oneTimePayments.forRun.mockResolvedValue([
        { id: 'otp-1', employeeId: 'emp-2', kind: 'BONUS', name: 'Bonus', amount: new Decimal(10000), taxable: true },
      ]);
      inputs.settings.get.mockResolvedValue({ reimburseExpensesViaPayroll: true, autoArrears: true });
      inputs.reimbursements.claimsForRun.mockResolvedValue([
        { id: 'cl-1', employeeId: 'emp-2', amount: new Decimal(1200) },
      ]);

      await service.processRun(tenantId, 'run-10', makerId);

      expect(inputs.arrears.detectForEmployee).toHaveBeenCalledWith(tenantId, 'emp-1');
      expect(inputs.arrears.detectForEmployee).toHaveBeenCalledWith(tenantId, 'emp-2');
      expect(inputs.arrears.pendingForRun).toHaveBeenCalledWith(tenantId, regularDraft, ['emp-1', 'emp-2']);

      const [, , , , emp1Options] = calc.calculateForEmployee.mock.calls[0];
      expect(emp1Options).toEqual({
        payrollRunId: 'run-10',
        extras: { arrears: [{ id: 'ar-1', amount: new Decimal(5000), pfWagesDelta: new Decimal(4000), financialYear: 2026 }] },
      });
      const emp2Options = calc.calculateForEmployee.mock.calls[1][4];
      expect(emp2Options.extras.oneTimePayments[0]).toMatchObject({ id: 'otp-1', kind: 'BONUS' });
      expect(emp2Options.extras.reimbursements).toEqual([{ id: 'cl-1', amount: new Decimal(1200) }]);

      // Detached before, attached after the payslips are replaced.
      expect(inputs.arrears.detachFromRun).toHaveBeenCalledWith(prisma, tenantId, 'run-10');
      expect(inputs.reimbursements.detachFromRun).toHaveBeenCalledWith(prisma, tenantId, 'run-10');
      expect(inputs.arrears.attachToRun).toHaveBeenCalledWith(prisma, tenantId, 'run-10', ['ar-1']);
      expect(inputs.reimbursements.attachToRun).toHaveBeenCalledWith(prisma, tenantId, 'run-10', ['cl-1']);
      expect(loans.clearPayrollRepayments).toHaveBeenCalled();
      expect(prisma.payrollRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPUTED', needsRecompute: false }) }),
      );
    });

    it('writes the new payslip columns and line kinds', async () => {
      calc.calculateForEmployee.mockImplementation(async (_t: string, id: string) => ({
        ...slip(id),
        earnings: [{ name: 'Arrears', amount: new Decimal(5000), kind: 'ARREAR', taxable: true }],
        deductions: [{ name: 'TDS', amount: new Decimal(100), kind: 'STATUTORY' }],
        nonRecurringTaxable: new Decimal(5000),
        arrearsAmount: new Decimal(5000),
        nonTaxableEarnings: new Decimal(700),
        reimbursementAmount: new Decimal(700),
      }));

      await service.processRun(tenantId, 'run-10', makerId);

      const row = prisma.payslip.createMany.mock.calls[0][0].data[0];
      expect(row.earnings).toEqual([{ name: 'Arrears', amount: 5000, kind: 'ARREAR', taxable: true }]);
      expect(row.deductions).toEqual([{ name: 'TDS', amount: 100, kind: 'STATUTORY' }]);
      expect(row.nonRecurringTaxable.toString()).toBe('5000');
      expect(row.nonTaxableEarnings.toString()).toBe('700');
      expect(row.arrearsAmount.toString()).toBe('5000');
      expect(row.reimbursementAmount.toString()).toBe('700');
    });

    it('does not detect arrears when the tenant switched it off, nor read claims unless enabled', async () => {
      inputs.settings.get.mockResolvedValue({ reimburseExpensesViaPayroll: false, autoArrears: false });
      await service.processRun(tenantId, 'run-10', makerId);
      expect(inputs.arrears.detectForEmployee).not.toHaveBeenCalled();
      expect(inputs.reimbursements.claimsForRun).not.toHaveBeenCalled();
    });

    it('refuses, and returns to DRAFT, when an input belongs to someone no longer active', async () => {
      inputs.oneTimePayments.forRun.mockResolvedValue([
        { id: 'otp-1', employeeId: 'emp-left', kind: 'BONUS', name: 'Bonus', amount: new Decimal(1), taxable: true },
      ]);
      await expect(service.processRun(tenantId, 'run-10', makerId)).rejects.toThrow(/no longer active/);
      expect(prisma.payrollRun.update).toHaveBeenLastCalledWith({
        where: { id: 'run-10' },
        data: { status: PayrollRunStatus.DRAFT },
      });
      expect(prisma.payslip.createMany).not.toHaveBeenCalled();
    });

    it('rolls the whole write back when another run took an arrear first (409)', async () => {
      inputs.arrears.pendingForRun.mockResolvedValue([
        { id: 'ar-1', employeeId: 'emp-1', amount: new Decimal(5000), pfWagesDelta: zero(), financialYear: 2026 },
      ]);
      inputs.arrears.attachToRun.mockRejectedValue(new ConflictException('taken'));
      await expect(service.processRun(tenantId, 'run-10', makerId)).rejects.toBeInstanceOf(ConflictException);
      expect(engine.start).not.toHaveBeenCalled();
    });

    it('recomputes the covered employees plus anyone an input was added for since', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...regularDraft, status: 'COMPUTED', totalGross: zero(), totalDeductions: zero(), totalNet: zero(),
        processedCount: 1, needsRecompute: true,
      });
      prisma.payslip.findMany.mockResolvedValue([{ employeeId: 'emp-1' }]);
      inputs.holds.releasesForRun.mockResolvedValue([
        { id: 'hold-1', employeeId: 'emp-3', heldAmount: new Decimal(52000), payrollRun: { month: 3, year: 2026 } },
      ]);
      prisma.payrollRun.update.mockResolvedValue({
        id: 'run-10', status: 'COMPUTED', totalGross: zero(), totalDeductions: zero(), totalNet: zero(), processedCount: 2,
      });

      await service.recomputeRun(tenantId, 'run-10', makerId);

      expect(calc.calculateForEmployee.mock.calls.map((c: unknown[]) => c[1])).toEqual(['emp-1', 'emp-3']);
      expect(calc.calculateForEmployee.mock.calls[1][4].extras.holdReleases).toEqual([
        { id: 'hold-1', amount: new Decimal(52000), heldMonth: 3, heldYear: 2026 },
      ]);
      expect(prisma.payrollRun.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ needsRecompute: false }) }),
      );
    });
  });

  // -------------------------------------------------------------- off-cycle

  describe('processing an off-cycle run', () => {
    beforeEach(() => {
      prisma.payrollRun.findFirst.mockResolvedValue(offCycleDraft);
    });

    it('computes only its scope, with no loans, PT or LWF, and never touches loan repayments', async () => {
      calc.calculateForEmployee.mockImplementation(async (_t: string, id: string) => (id === 'emp-2' ? null : slip(id)));

      await service.processRun(tenantId, 'run-oc', makerId);

      expect(prisma.employee.findMany).not.toHaveBeenCalled();
      expect(inputs.arrears.detectForEmployee).not.toHaveBeenCalled();
      expect(calc.calculateForEmployee).toHaveBeenCalledWith(tenantId, 'emp-1', 10, 2026, {
        payrollRunId: 'run-oc', offCycle: true, includeSalary: false,
        deductLoans: false, chargeMonthlyStatutory: false,
      });
      expect(loans.clearPayrollRepayments).not.toHaveBeenCalled();
      expect(loans.recordPayrollRepayments).not.toHaveBeenCalled();
      // emp-2 had nothing to pay: one payslip.
      expect(prisma.payslip.createMany.mock.calls[0][0].data).toHaveLength(1);
    });

    const settlement = {
      id: 'set-1', employeeId: 'emp-1', status: 'APPROVED', netPayable: new Decimal(87000),
      lastWorkingDate: new Date('2026-10-10T12:00:00Z'), payrollRunId: 'run-oc',
      proRataSalary: new Decimal(20000), leaveEncashment: new Decimal(30000), leaveEncashmentExempt: new Decimal(10000),
      gratuity: new Decimal(50000), gratuityExempt: new Decimal(50000), otherEarnings: zero(),
      noticeRecovery: new Decimal(5000), otherRecoveries: new Decimal(1000), totalRecoveries: new Decimal(9000),
      tds: new Decimal(4000),
      employee: { id: 'emp-1', employeeCode: 'E001', firstName: 'Asha', lastName: 'Rao' },
    };

    it('pays a carried settlement verbatim and alone: no arrears or claims for that employee', async () => {
      prisma.settlement.findMany.mockResolvedValue([settlement]);
      await service.processRun(tenantId, 'run-oc', makerId);
      expect(calc.calculateForEmployee.mock.calls[0][4].extras.settlement).toMatchObject({
        id: 'set-1', netPayable: new Decimal(87000), tds: new Decimal(4000),
      });
      expect(inputs.arrears.pendingForRun).toHaveBeenCalledWith(tenantId, offCycleDraft, ['emp-2']);
    });

    it('refuses a settlement combined with other payments for the same employee', async () => {
      prisma.settlement.findMany.mockResolvedValue([settlement]);
      inputs.oneTimePayments.forRun.mockResolvedValue([
        { id: 'otp-1', employeeId: 'emp-1', kind: 'BONUS', name: 'Bonus', amount: new Decimal(1), taxable: true },
      ]);
      await expect(service.processRun(tenantId, 'run-oc', makerId)).rejects.toThrow(/own payslip/);
    });
  });

  // ------------------------------------------ off-cycle salary (review C1)

  describe('an off-cycle run paying salary', () => {
    const salaryRun = { ...offCycleDraft, includeSalary: true };
    const approvedRegular = { id: 'run-10', status: 'APPROVED' };
    const actor = { userId: 'u-checker', tenantId, email: 'e', role: 'HR_ADMIN' } as any;
    const createDto = { month: 10, year: 2026, reason: 'Joiners', includeSalary: true, employeeIds: ['emp-1', 'emp-2'] };
    const elsewhereSelect = { employeeId: true, employee: { select: { employeeCode: true } } };

    const elsewhereWhere = (excludeRunId: string | undefined, employeeIds: string[]) => ({
      tenantId,
      employeeId: { in: employeeIds },
      ...(excludeRunId ? { payrollRunId: { not: excludeRunId } } : {}),
      payrollRun: {
        tenantId, month: 10, year: 2026,
        OR: [{ runType: 'REGULAR' }, { runType: 'OFF_CYCLE', includeSalary: true }],
      },
    });

    beforeEach(() => {
      prisma.payrollRun.findUnique.mockResolvedValue(approvedRegular);
      prisma.employee.findMany.mockResolvedValue([{ id: 'emp-1' }, { id: 'emp-2' }]);
    });

    it.each([
      ['does not exist', null],
      ['is DRAFT', { ...approvedRegular, status: 'DRAFT' }],
      ['is COMPUTED', { ...approvedRegular, status: 'COMPUTED' }],
    ])('cannot be created while the regular run %s', async (_label, regular) => {
      prisma.payrollRun.findUnique.mockResolvedValue(regular);
      await expect(service.createOffCycleRun(tenantId, createDto)).rejects.toThrow(
        'Process and approve the regular run for this month first; off-cycle salary is for employees it did not pay',
      );
      expect(prisma.payrollRun.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_month_year_runType_sequence: { tenantId, month: 10, year: 2026, runType: 'REGULAR', sequence: 0 },
        },
        select: { id: true, status: true },
      });
      expect(prisma.payrollRun.create).not.toHaveBeenCalled();
    });

    it('cannot be created for someone another run already paid salary for the month', async () => {
      prisma.payslip.findMany.mockResolvedValue([{ employeeId: 'emp-2', employee: { employeeCode: 'E002' } }]);
      await expect(service.createOffCycleRun(tenantId, createDto)).rejects.toThrow(/E002/);
      expect(prisma.payslip.findMany).toHaveBeenCalledWith({
        where: elsewhereWhere(undefined, ['emp-1', 'emp-2']),
        select: elsewhereSelect,
      });
      expect(prisma.payrollRun.create).not.toHaveBeenCalled();
    });

    it('is created once the regular run is approved and nobody in scope was paid', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);
      prisma.payrollRun.create.mockImplementation(async ({ data }: any) => ({ id: 'run-oc', ...data }));
      await expect(service.createOffCycleRun(tenantId, createDto)).resolves.toMatchObject({ includeSalary: true });
    });

    it('a bonus-only off-cycle run needs no regular run', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue(null);
      prisma.payrollRun.findFirst.mockResolvedValue(null);
      prisma.payrollRun.create.mockImplementation(async ({ data }: any) => ({ id: 'run-oc', ...data }));
      await expect(
        service.createOffCycleRun(tenantId, { ...createDto, includeSalary: false }),
      ).resolves.toMatchObject({ includeSalary: false });
    });

    it('path 1: is not processed while the regular run is still DRAFT, so that run cannot pay them again', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(salaryRun);
      prisma.payrollRun.findUnique.mockResolvedValue({ ...approvedRegular, status: 'DRAFT' });

      await expect(service.processRun(tenantId, 'run-oc', makerId)).rejects.toThrow(
        /Process and approve the regular run for this month first/,
      );
      expect(calc.calculateForEmployee).not.toHaveBeenCalled();
      expect(prisma.payslip.createMany).not.toHaveBeenCalled();
      expect(prisma.payrollRun.update).toHaveBeenLastCalledWith({
        where: { id: 'run-oc' },
        data: { status: PayrollRunStatus.DRAFT },
      });
    });

    it('path 2: refuses to pay salary another off-cycle salary run already paid', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(salaryRun);
      prisma.payslip.findMany.mockResolvedValue([{ employeeId: 'emp-1', employee: { employeeCode: 'E001' } }]);

      await expect(service.processRun(tenantId, 'run-oc', makerId)).rejects.toThrow(/E001/);
      expect(prisma.payslip.findMany).toHaveBeenCalledWith({
        where: elsewhereWhere('run-oc', ['emp-1', 'emp-2']),
        select: elsewhereSelect,
      });
      expect(calc.calculateForEmployee).not.toHaveBeenCalled();
    });

    it('checks again inside the write transaction (two runs computing at once)', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(salaryRun);
      prisma.payslip.findMany
        .mockResolvedValueOnce([]) // before computing
        .mockResolvedValueOnce([{ employeeId: 'emp-1', employee: { employeeCode: 'E001' } }]); // in the tx

      await expect(service.processRun(tenantId, 'run-oc', makerId)).rejects.toThrow(/E001/);
      expect(prisma.payslip.findMany).toHaveBeenNthCalledWith(2, {
        where: elsewhereWhere('run-oc', ['emp-1', 'emp-2']),
        select: elsewhereSelect,
      });
      expect(engine.start).not.toHaveBeenCalled();
    });

    it('recompute applies the same rules', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...salaryRun, status: 'COMPUTED', totalGross: zero(), totalDeductions: zero(), totalNet: zero(), processedCount: 2,
      });
      prisma.payrollRun.findUnique.mockResolvedValue({ ...approvedRegular, status: 'COMPUTED' });

      await expect(service.recomputeRun(tenantId, 'run-oc', makerId)).rejects.toThrow(
        /Process and approve the regular run for this month first/,
      );
      expect(calc.calculateForEmployee).not.toHaveBeenCalled();
    });

    it('checks again at approval, inside the approval transaction', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({ ...salaryRun, status: 'COMPUTED' });
      prisma.payslip.findMany
        .mockResolvedValueOnce([{ employeeId: 'emp-1' }]) // this run's payslips
        .mockResolvedValueOnce([{ employeeId: 'emp-1', employee: { employeeCode: 'E001' } }]);

      await expect(service.approveRun(tenantId, 'run-oc', actor)).rejects.toThrow(/E001/);
      expect(prisma.payslip.findMany).toHaveBeenNthCalledWith(1, {
        where: { tenantId, payrollRunId: 'run-oc' },
        select: { employeeId: true },
      });
      expect(prisma.payslip.findMany).toHaveBeenNthCalledWith(2, {
        where: elsewhereWhere('run-oc', ['emp-1']),
        select: elsewhereSelect,
      });
      expect(prisma.payrollRun.update).not.toHaveBeenCalled();
    });

    it('approves when nobody it pays was paid elsewhere; a regular run skips the check', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({ ...salaryRun, status: 'COMPUTED' });
      prisma.payslip.findMany.mockResolvedValueOnce([{ employeeId: 'emp-1' }]).mockResolvedValueOnce([]);
      prisma.payrollRun.update.mockResolvedValue({ id: 'run-oc', status: 'APPROVED' });
      await expect(service.approveRun(tenantId, 'run-oc', actor)).resolves.toMatchObject({ status: 'APPROVED' });

      prisma.payslip.findMany.mockClear();
      prisma.payrollRun.findFirst.mockResolvedValue({ ...regularDraft, status: 'COMPUTED' });
      await service.approveRun(tenantId, 'run-10', actor);
      expect(prisma.payslip.findMany).not.toHaveBeenCalled();
    });
  });

  // ------------------------------------------------------ approval / paying

  it('refuses to approve a run whose inputs changed since it was computed', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue({ ...regularDraft, status: 'COMPUTED', needsRecompute: true });
    await expect(
      service.approveRun(tenantId, 'run-10', { userId: 'u', tenantId, email: 'e', role: 'HR_ADMIN' } as any),
    ).rejects.toThrow('Inputs changed since this run was computed; recompute it before approval');
    expect(engine.act).not.toHaveBeenCalled();
  });

  it('marks paid and settles arrears, claims and settlements in one transaction, then notifies', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue({ ...regularDraft, status: 'APPROVED' });
    prisma.payrollRun.update.mockResolvedValue({ id: 'run-10', status: 'PAID' });
    const claims = [{ id: 'cl-1', employeeId: 'emp-1', amount: new Decimal(1200) }];
    inputs.reimbursements.settleForRun.mockResolvedValue(claims);

    await service.markAsPaid(tenantId, 'run-10');

    const paidAt = prisma.payrollRun.update.mock.calls[0][0].data.paidAt;
    expect(paidAt).toBeInstanceOf(Date);
    expect(inputs.arrears.markPaidForRun).toHaveBeenCalledWith(prisma, tenantId, 'run-10');
    expect(inputs.reimbursements.settleForRun).toHaveBeenCalledWith(prisma, tenantId, 'run-10', paidAt);
    expect(prisma.settlement.updateMany).toHaveBeenCalledWith({
      where: { tenantId, payrollRunId: 'run-10', status: 'APPROVED' },
      data: { status: 'PAID', paidAt },
    });
    expect(inputs.reimbursements.notifyReimbursed).toHaveBeenCalledWith(tenantId, claims);
  });

  it('answers 409 when a concurrent call marked the run paid first', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue({ ...regularDraft, status: 'APPROVED' });
    prisma.payrollRun.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('nf', { code: 'P2025', clientVersion: 't' }),
    );
    await expect(service.markAsPaid(tenantId, 'run-10')).rejects.toBeInstanceOf(ConflictException);
    expect(inputs.reimbursements.notifyReimbursed).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------- reset / delete

  it('reset and delete detach what the run carried; an off-cycle run never clears loans', async () => {
    prisma.payrollRun.findFirst.mockResolvedValue({ ...offCycleDraft, status: 'PROCESSING' });
    prisma.payrollRun.update.mockResolvedValue({ id: 'run-oc', status: 'DRAFT' });
    await service.resetRun(tenantId, 'run-oc');

    prisma.payrollRun.findFirst.mockResolvedValue(offCycleDraft);
    await service.deleteRun(tenantId, 'run-oc', 'HR_ADMIN' as any);

    expect(loans.clearPayrollRepayments).not.toHaveBeenCalled();
    expect(inputs.arrears.detachFromRun).toHaveBeenCalledTimes(2);
    expect(inputs.reimbursements.detachFromRun).toHaveBeenCalledTimes(2);
    expect(inputs.holds.detachReleases).toHaveBeenCalledTimes(2);
    expect(prisma.settlement.updateMany).toHaveBeenCalledWith({
      where: { tenantId, payrollRunId: 'run-oc', status: 'APPROVED' },
      data: { payrollRunId: null },
    });
    expect(prisma.payrollRun.delete).toHaveBeenCalledWith({ where: { id: 'run-oc' } });
  });

  // ------------------------------------------------------------ settlements

  describe('settlements through an off-cycle run', () => {
    const approved = { id: 'set-1', status: 'APPROVED', employeeId: 'emp-1', payrollRunId: null };

    beforeEach(() => {
      prisma.payrollRun.findFirst.mockResolvedValue({ ...offCycleDraft, status: 'COMPUTED' });
      prisma.settlement.findFirst.mockResolvedValue(approved);
      prisma.settlement.updateMany.mockResolvedValue({ count: 1 });
    });

    it('attaches an approved settlement of an in-scope employee and flags the recompute', async () => {
      await service.attachSettlement(tenantId, 'run-oc', 'set-1');
      expect(prisma.settlement.updateMany).toHaveBeenCalledWith({
        where: { id: 'set-1', tenantId, status: 'APPROVED', payrollRunId: null },
        data: { payrollRunId: 'run-oc' },
      });
      expect(prisma.payrollRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'run-oc', tenantId, status: 'COMPUTED' },
        data: { needsRecompute: true },
      });
    });

    it('refuses a regular run, a carried or unapproved settlement, or one out of scope', async () => {
      prisma.payrollRun.findFirst.mockResolvedValueOnce({ ...regularDraft });
      await expect(service.attachSettlement(tenantId, 'run-10', 'set-1')).rejects.toThrow(/off-cycle/);

      prisma.settlement.findFirst.mockResolvedValueOnce({ ...approved, payrollRunId: 'run-x' });
      await expect(service.attachSettlement(tenantId, 'run-oc', 'set-1')).rejects.toBeInstanceOf(ConflictException);

      prisma.settlement.findFirst.mockResolvedValueOnce({ ...approved, status: 'PAID' });
      await expect(service.attachSettlement(tenantId, 'run-oc', 'set-1')).rejects.toBeInstanceOf(BadRequestException);

      prisma.settlement.findFirst.mockResolvedValueOnce({ ...approved, employeeId: 'emp-9' });
      await expect(service.attachSettlement(tenantId, 'run-oc', 'set-1')).rejects.toThrow(/scope/);

      prisma.settlement.findFirst.mockResolvedValueOnce(null);
      await expect(service.attachSettlement(tenantId, 'run-oc', 'set-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('detaches a carried settlement', async () => {
      prisma.settlement.findFirst.mockResolvedValue({ id: 'set-1' });
      await service.detachSettlement(tenantId, 'run-oc', 'set-1');
      expect(prisma.settlement.updateMany).toHaveBeenCalledWith({
        where: { id: 'set-1', tenantId, payrollRunId: 'run-oc', status: 'APPROVED' },
        data: { payrollRunId: null },
      });
    });
  });
});
