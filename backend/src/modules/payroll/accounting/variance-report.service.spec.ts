import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createMockPrismaService } from '../../../test/helpers';
import { VarianceReportService } from './variance-report.service';

describe('VarianceReportService', () => {
  let prisma: ReturnType<typeof createMockPrismaService>;
  let service: VarianceReportService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new VarianceReportService(prisma);
  });

  const run = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-current',
    tenantId: 'tenant-1',
    month: 9,
    year: 2026,
    runType: 'REGULAR',
    sequence: 0,
    status: 'APPROVED',
    ...overrides,
  });

  const employee = (code: string, department = 'Engineering') => ({
    employeeCode: code,
    firstName: 'Jane',
    lastName: 'Doe',
    department: { name: department },
  });

  it('throws 404 when the run does not exist for this tenant', async () => {
    (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.build('tenant-1', { runId: 'run-1' })).rejects.toThrow(NotFoundException);
  });

  it('refuses a DRAFT or PROCESSING run', async () => {
    (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValue(run({ status: 'PROCESSING' }));
    await expect(service.build('tenant-1', { runId: 'run-1' })).rejects.toThrow(BadRequestException);
  });

  it('defaults the comparison to the previous month\'s REGULAR run', async () => {
    (prisma.payrollRun.findFirst as jest.Mock)
      .mockResolvedValueOnce(run()) // the requested run
      .mockResolvedValueOnce(run({ id: 'run-prev', month: 8 })); // resolveCompareRun lookup
    (prisma.payslip.findMany as jest.Mock).mockResolvedValue([]);

    const report = await service.build('tenant-1', { runId: 'run-current' });

    expect(prisma.payrollRun.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        tenantId: 'tenant-1',
        runType: 'REGULAR',
        month: 8,
        year: 2026,
        status: { notIn: ['DRAFT', 'PROCESSING'] },
      },
    });
    expect(report.compareRun?.id).toBe('run-prev');
  });

  it('returns compareRun null when there is no previous run', async () => {
    (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValueOnce(run()).mockResolvedValueOnce(null);
    (prisma.payslip.findMany as jest.Mock).mockResolvedValue([]);

    const report = await service.build('tenant-1', { runId: 'run-current' });
    expect(report.compareRun).toBeNull();
  });

  it('marks an employee only in the current run as NEW and flags them', async () => {
    (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValueOnce(run()).mockResolvedValueOnce(null);
    (prisma.payslip.findMany as jest.Mock).mockResolvedValueOnce([
      {
        employeeId: 'emp-1',
        basePay: 50000,
        otPay: 0,
        earnings: [],
        deductions: [],
        grossPay: 50000,
        totalDeductions: 0,
        netPay: 50000,
        pfEmployee: 0,
        esiEmployee: 0,
        professionalTax: 0,
        lwfEmployee: 0,
        tds: 0,
        employee: employee('E001'),
      },
    ]);

    const report = await service.build('tenant-1', { runId: 'run-current' });

    expect(report.employees).toHaveLength(1);
    expect(report.employees[0].status).toBe('NEW');
    expect(report.employees[0].flagged).toBe(true);
  });

  it('marks an employee only in the previous run as LEFT', async () => {
    (prisma.payrollRun.findFirst as jest.Mock)
      .mockResolvedValueOnce(run())
      .mockResolvedValueOnce(run({ id: 'run-prev', month: 8 }));
    (prisma.payslip.findMany as jest.Mock)
      .mockResolvedValueOnce([]) // current run payslips
      .mockResolvedValueOnce([
        {
          employeeId: 'emp-2',
          basePay: 40000,
          otPay: 0,
          earnings: [],
          deductions: [],
          grossPay: 40000,
          totalDeductions: 0,
          netPay: 40000,
          pfEmployee: 0,
          esiEmployee: 0,
          professionalTax: 0,
          lwfEmployee: 0,
          tds: 0,
          employee: employee('E002'),
        },
      ]);

    const report = await service.build('tenant-1', { runId: 'run-current' });
    expect(report.employees[0].status).toBe('LEFT');
  });

  it('flags an employee whose net pay changed by at least the threshold, with a null deltaPct on 0 previous', async () => {
    (prisma.payrollRun.findFirst as jest.Mock)
      .mockResolvedValueOnce(run())
      .mockResolvedValueOnce(run({ id: 'run-prev', month: 8 }));
    (prisma.payslip.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          employeeId: 'emp-3',
          basePay: 55000,
          otPay: 0,
          earnings: [],
          deductions: [],
          grossPay: 55000,
          totalDeductions: 0,
          netPay: 55000,
          pfEmployee: 0,
          esiEmployee: 0,
          professionalTax: 0,
          lwfEmployee: 0,
          tds: 0,
          employee: employee('E003'),
        },
      ])
      .mockResolvedValueOnce([
        {
          employeeId: 'emp-3',
          basePay: 50000,
          otPay: 0,
          earnings: [],
          deductions: [],
          grossPay: 50000,
          totalDeductions: 0,
          netPay: 50000,
          pfEmployee: 0,
          esiEmployee: 0,
          professionalTax: 0,
          lwfEmployee: 0,
          tds: 0,
          employee: employee('E003'),
        },
      ]);

    const report = await service.build('tenant-1', { runId: 'run-current', thresholdPct: 5 });
    const row = report.employees[0];
    expect(row.status).toBe('CHANGED');
    expect(row.net.deltaPct).toBe(10);
    expect(row.flagged).toBe(true);
    const basic = row.components.find((c) => c.key === 'BASIC');
    expect(basic).toMatchObject({ current: 55000, previous: 50000, delta: 5000 });
  });

  it('only lists components whose delta is non-zero', async () => {
    (prisma.payrollRun.findFirst as jest.Mock)
      .mockResolvedValueOnce(run())
      .mockResolvedValueOnce(run({ id: 'run-prev', month: 8 }));
    const samePayslip = {
      employeeId: 'emp-4',
      basePay: 50000,
      otPay: 0,
      earnings: [{ name: 'HRA', amount: 5000, kind: 'COMPONENT' }],
      deductions: [],
      grossPay: 55000,
      totalDeductions: 0,
      netPay: 55000,
      pfEmployee: 0,
      esiEmployee: 0,
      professionalTax: 0,
      lwfEmployee: 0,
      tds: 0,
      employee: employee('E004'),
    };
    (prisma.payslip.findMany as jest.Mock)
      .mockResolvedValueOnce([samePayslip])
      .mockResolvedValueOnce([{ ...samePayslip }]);

    const report = await service.build('tenant-1', { runId: 'run-current' });
    expect(report.employees[0].status).toBe('UNCHANGED');
    expect(report.employees[0].components).toEqual([]);
  });

  it('builds run-level component rows with employeesAffected', async () => {
    (prisma.payrollRun.findFirst as jest.Mock)
      .mockResolvedValueOnce(run())
      .mockResolvedValueOnce(run({ id: 'run-prev', month: 8 }));
    (prisma.payslip.findMany as jest.Mock)
      .mockResolvedValueOnce([
        {
          employeeId: 'emp-5',
          basePay: 60000,
          otPay: 0,
          earnings: [],
          deductions: [],
          grossPay: 60000,
          totalDeductions: 0,
          netPay: 60000,
          pfEmployee: 0,
          esiEmployee: 0,
          professionalTax: 0,
          lwfEmployee: 0,
          tds: 0,
          employee: employee('E005'),
        },
      ])
      .mockResolvedValueOnce([
        {
          employeeId: 'emp-5',
          basePay: 50000,
          otPay: 0,
          earnings: [],
          deductions: [],
          grossPay: 50000,
          totalDeductions: 0,
          netPay: 50000,
          pfEmployee: 0,
          esiEmployee: 0,
          professionalTax: 0,
          lwfEmployee: 0,
          tds: 0,
          employee: employee('E005'),
        },
      ]);

    const report = await service.build('tenant-1', { runId: 'run-current' });
    const basicRow = report.components.find((c) => c.key === 'BASIC');
    expect(basicRow).toMatchObject({ current: 60000, previous: 50000, delta: 10000, employeesAffected: 1 });
  });

  describe('exportCsv', () => {
    it('produces a CSV with the header row and a formula-injection guard', async () => {
      (prisma.payrollRun.findFirst as jest.Mock).mockResolvedValueOnce(run()).mockResolvedValueOnce(null);
      (prisma.payslip.findMany as jest.Mock).mockResolvedValueOnce([
        {
          employeeId: 'emp-6',
          basePay: 50000,
          otPay: 0,
          earnings: [],
          deductions: [],
          grossPay: 50000,
          totalDeductions: 0,
          netPay: 50000,
          pfEmployee: 0,
          esiEmployee: 0,
          professionalTax: 0,
          lwfEmployee: 0,
          tds: 0,
          employee: { employeeCode: 'E006', firstName: '=CMD', lastName: 'Evil', department: null },
        },
      ]);

      const file = await service.exportCsv('tenant-1', { runId: 'run-current' });
      expect(file.filename).toBe('variance-2026-09.csv');
      expect(file.content.split('\r\n')[0]).toBe(
        'Employee Code,Name,Department,Status,Gross Current,Gross Previous,Gross Delta,Deductions Current,Deductions Previous,Deductions Delta,Net Current,Net Previous,Net Delta,Net Delta %,Flagged',
      );
      expect(file.content).toContain("'=CMD");
    });
  });
});
