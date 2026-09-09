import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';
import {
  ReturnsService,
  quarterOf,
  quarterLabel,
  monthsOfQuarter,
} from './returns.service';

const TENANT = 'tenant-1';
const RUN_ID = 'run-1';

/** A COMPUTED May 2026 run, which is the point from which everything is filed. */
function computedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    tenantId: TENANT,
    month: 5,
    year: 2026,
    status: 'COMPUTED',
    ...overrides,
  };
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    pfWageCeiling: new Decimal(15000),
    ptState: 'Karnataka',
    ...overrides,
  };
}

/**
 * Asha Rao: full statutory identifiers, PF at the ceiling, above the ESI
 * wage limit so not covered, two days of loss of pay.
 */
function payslipA(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ps-a',
    tenantId: TENANT,
    payrollRunId: RUN_ID,
    employeeId: 'emp-a',
    workingDays: 30,
    lopDays: 2,
    grossPay: new Decimal(30000),
    netPay: new Decimal(27300),
    pfWages: new Decimal(15000),
    pfEmployee: new Decimal(1800),
    pfEmployer: new Decimal(550),
    epsEmployer: new Decimal(1250),
    edliEmployer: new Decimal(75),
    pfAdminEmployer: new Decimal(75),
    esiWages: new Decimal(0),
    esiEmployee: new Decimal(0),
    esiEmployer: new Decimal(0),
    professionalTax: new Decimal(200),
    tds: new Decimal(1500),
    employee: {
      id: 'emp-a',
      employeeCode: 'E001',
      firstName: 'Asha',
      lastName: 'Rao',
      uan: '100200300400',
      esiNumber: '3100123456789',
      pan: 'ABCDE1234F',
      bankAccountNumber: '000123456789',
      bankIfsc: 'HDFC0000123',
      bankName: 'HDFC Bank',
      currentState: 'Karnataka',
      branch: { state: 'Karnataka' },
    },
    ...overrides,
  };
}

/**
 * "Bo, Jr" Singh: no UAN, so cannot go in the ECR. Covered by ESI. The comma
 * in the name is deliberate — it must survive CSV quoting.
 */
function payslipB(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ps-b',
    tenantId: TENANT,
    payrollRunId: RUN_ID,
    employeeId: 'emp-b',
    workingDays: 30,
    lopDays: 0,
    grossPay: new Decimal(18000),
    netPay: new Decimal(15265),
    pfWages: new Decimal(15000),
    pfEmployee: new Decimal(1800),
    pfEmployer: new Decimal(550),
    epsEmployer: new Decimal(1250),
    edliEmployer: new Decimal(75),
    pfAdminEmployer: new Decimal(75),
    esiWages: new Decimal(18000),
    esiEmployee: new Decimal(135),
    esiEmployer: new Decimal(585),
    professionalTax: new Decimal(200),
    tds: new Decimal(0),
    employee: {
      id: 'emp-b',
      employeeCode: 'E002',
      firstName: 'Bo, Jr',
      lastName: 'Singh',
      uan: null,
      esiNumber: '3100987654321',
      pan: null,
      bankAccountNumber: '000987654321',
      bankIfsc: 'ICIC0000456',
      bankName: 'ICICI Bank',
      currentState: 'Maharashtra',
      branch: null,
    },
    ...overrides,
  };
}

/**
 * Chandra Iyer: ESI covered but no insurance number, and no bank details at
 * all, so drops out of two of the five files.
 */
function payslipC(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ps-c',
    tenantId: TENANT,
    payrollRunId: RUN_ID,
    employeeId: 'emp-c',
    workingDays: 30,
    lopDays: 0,
    grossPay: new Decimal(20000),
    netPay: new Decimal(18500),
    pfWages: new Decimal(0),
    pfEmployee: new Decimal(0),
    pfEmployer: new Decimal(0),
    epsEmployer: new Decimal(0),
    edliEmployer: new Decimal(0),
    pfAdminEmployer: new Decimal(0),
    esiWages: new Decimal(20000),
    esiEmployee: new Decimal(150),
    esiEmployer: new Decimal(650),
    professionalTax: new Decimal(200),
    tds: new Decimal(500),
    employee: {
      id: 'emp-c',
      employeeCode: 'E003',
      firstName: 'Chandra',
      lastName: 'Iyer',
      uan: '100200300401',
      esiNumber: null,
      pan: 'ZYXWV9876K',
      bankAccountNumber: null,
      bankIfsc: null,
      bankName: null,
      currentState: null,
      branch: null,
    },
    ...overrides,
  };
}

describe('quarterOf', () => {
  it('numbers the quarters from April, as the income tax year runs', () => {
    expect(quarterOf(4)).toBe(1); // April opens Q1
    expect(quarterOf(6)).toBe(1);
    expect(quarterOf(7)).toBe(2);
    expect(quarterOf(12)).toBe(3);
    expect(quarterOf(1)).toBe(4); // January is in the last quarter
    expect(quarterOf(3)).toBe(4);
  });
});

describe('quarterLabel', () => {
  it('names the quarter with the financial year it belongs to', () => {
    expect(quarterLabel(1, 2026)).toBe('Q1-2026-27');
    expect(quarterLabel(4, 2026)).toBe('Q4-2026-27');
  });
});

describe('monthsOfQuarter', () => {
  it('lists Q1 as April to June of the opening calendar year', () => {
    expect(monthsOfQuarter(1, 2026)).toEqual([
      { month: 4, year: 2026 },
      { month: 5, year: 2026 },
      { month: 6, year: 2026 },
    ]);
  });

  it('rolls Q4 into the following calendar year', () => {
    expect(monthsOfQuarter(4, 2026)).toEqual([
      { month: 1, year: 2027 },
      { month: 2, year: 2027 },
      { month: 3, year: 2027 },
    ]);
  });
});

describe('ReturnsService', () => {
  let service: ReturnsService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReturnsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get(ReturnsService);
    prisma = module.get(PrismaService);
    prisma.statutoryConfig.findUnique.mockResolvedValue(config());
  });

  // -------------------------------------------------------------------------
  // Guards shared by every return
  // -------------------------------------------------------------------------

  describe('run eligibility', () => {
    it('refuses a run belonging to another tenant', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.pfEcr(TENANT, RUN_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('scopes the run lookup by tenant', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
      prisma.payslip.findMany.mockResolvedValue([payslipA()]);

      await service.pfEcr(TENANT, RUN_ID);

      expect(prisma.payrollRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: RUN_ID, tenantId: TENANT }),
        }),
      );
    });

    it('scopes the payslip lookup by tenant', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
      prisma.payslip.findMany.mockResolvedValue([payslipA()]);

      await service.pfEcr(TENANT, RUN_ID);

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: TENANT, payrollRunId: RUN_ID }),
        }),
      );
    });

    it.each(['DRAFT', 'PROCESSING'])(
      'refuses to file from a %s run, which has no settled payslips',
      async (status) => {
        prisma.payrollRun.findFirst.mockResolvedValue(computedRun({ status }));

        await expect(service.pfEcr(TENANT, RUN_ID)).rejects.toBeInstanceOf(
          BadRequestException,
        );
      },
    );

    it.each(['COMPUTED', 'APPROVED', 'PAID'])('files from a %s run', async (status) => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun({ status }));
      prisma.payslip.findMany.mockResolvedValue([payslipA()]);

      await expect(service.pfEcr(TENANT, RUN_ID)).resolves.toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // PF ECR
  // -------------------------------------------------------------------------

  describe('pfEcr', () => {
    beforeEach(() => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
    });

    it('writes one #~# delimited line per member in ECR field order', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipA()]);

      const file = await service.pfEcr(TENANT, RUN_ID);

      // UAN, name, gross, EPF wages, EPS wages, EDLI wages, EPF due, EPS due,
      // EPF-EPS diff due, NCP days, refund of advances.
      expect(file.content).toBe(
        '100200300400#~#Asha Rao#~#30000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#2#~#0',
      );
      expect(file.warnings).toEqual([]);
    });

    it('names the file for the run month and serves it as plain text', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipA()]);

      const file = await service.pfEcr(TENANT, RUN_ID);

      expect(file.filename).toBe('pf-ecr-052026.txt');
      expect(file.contentType).toBe('text/plain');
    });

    it('caps EPS and EDLI wages at the statutory ceiling when PF ran on full wages', async () => {
      // Employer policy can put EPF on the whole wage; the pension cap is
      // statutory and applies regardless.
      prisma.payslip.findMany.mockResolvedValue([
        payslipA({ pfWages: new Decimal(25000), pfEmployee: new Decimal(3000) }),
      ]);

      const fields = (await service.pfEcr(TENANT, RUN_ID)).content.split('#~#');

      expect(fields[3]).toBe('25000'); // EPF wages, uncapped
      expect(fields[4]).toBe('15000'); // EPS wages, capped
      expect(fields[5]).toBe('15000'); // EDLI wages, capped
    });

    it('reports zero EPS and EDLI wages when neither contribution was made', async () => {
      prisma.payslip.findMany.mockResolvedValue([
        payslipA({ epsEmployer: new Decimal(0), edliEmployer: new Decimal(0) }),
      ]);

      const fields = (await service.pfEcr(TENANT, RUN_ID)).content.split('#~#');

      expect(fields[4]).toBe('0');
      expect(fields[5]).toBe('0');
    });

    it('skips a member with no UAN and says who was skipped and why', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipA(), payslipB()]);

      const file = await service.pfEcr(TENANT, RUN_ID);

      expect(file.content.split('\n')).toHaveLength(1);
      expect(file.warnings).toEqual([
        'E002 (Bo, Jr Singh): skipped from the PF ECR, no UAN on record',
      ]);
    });

    it('leaves out an employee who made no provident fund contribution', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipC()]);

      const file = await service.pfEcr(TENANT, RUN_ID);

      expect(file.content).toBe('');
      expect(file.warnings).toEqual([]);
    });

    it('falls back to uncapped pension wages when no ceiling is configured', async () => {
      prisma.statutoryConfig.findUnique.mockResolvedValue(null);
      prisma.payslip.findMany.mockResolvedValue([
        payslipA({ pfWages: new Decimal(25000) }),
      ]);

      const file = await service.pfEcr(TENANT, RUN_ID);

      expect(file.content.split('#~#')[4]).toBe('25000');
      expect(file.warnings).toEqual([
        'No statutory configuration for this tenant; EPS and EDLI wages are reported uncapped.',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // ESI return
  // -------------------------------------------------------------------------

  describe('esiReturn', () => {
    beforeEach(() => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
    });

    it('writes a header and one row per covered employee', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipB()]);

      const file = await service.esiReturn(TENANT, RUN_ID);

      expect(file.content.split('\n')).toEqual([
        'IP Number,IP Name,No of Days,Total Monthly Wages,Employee Contribution,Employer Contribution',
        '3100987654321,"Bo, Jr Singh",30,18000.00,135.00,585.00',
      ]);
      expect(file.filename).toBe('esi-return-052026.csv');
      expect(file.contentType).toBe('text/csv');
    });

    it('counts days as the working days actually paid for', async () => {
      prisma.payslip.findMany.mockResolvedValue([
        payslipB({ workingDays: 30, lopDays: 4 }),
      ]);

      const file = await service.esiReturn(TENANT, RUN_ID);

      expect(file.content.split('\n')[1]).toContain(',26,');
    });

    it('leaves out an employee above the wage limit, who is not covered', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipA()]);

      const file = await service.esiReturn(TENANT, RUN_ID);

      expect(file.content.split('\n')).toHaveLength(1); // header only
      expect(file.warnings).toEqual([]);
    });

    it('skips a covered employee with no insurance number and says so', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipB(), payslipC()]);

      const file = await service.esiReturn(TENANT, RUN_ID);

      expect(file.content.split('\n')).toHaveLength(2); // header plus B
      expect(file.warnings).toEqual([
        'E003 (Chandra Iyer): skipped from the ESI return, no ESI number on record',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Professional tax challan summary
  // -------------------------------------------------------------------------

  describe('professionalTaxChallan', () => {
    beforeEach(() => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
    });

    it('totals the deduction and the head count for each state', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipA(), payslipB(), payslipC()]);

      const file = await service.professionalTaxChallan(TENANT, RUN_ID);

      // A is placed by its branch, B by its own state, C falls back to the
      // configured PT state because it has neither.
      expect(file.content.split('\n')).toEqual([
        'State,Employee Count,Total Professional Tax',
        'Karnataka,2,400.00',
        'Maharashtra,1,200.00',
      ]);
      expect(file.filename).toBe('pt-challan-052026.csv');
      expect(file.contentType).toBe('text/csv');
      expect(file.warnings).toEqual([]);
    });

    it('leaves out anyone who had no professional tax deducted', async () => {
      prisma.payslip.findMany.mockResolvedValue([
        payslipA({ professionalTax: new Decimal(0) }),
      ]);

      const file = await service.professionalTaxChallan(TENANT, RUN_ID);

      expect(file.content.split('\n')).toHaveLength(1);
    });

    it('groups an employee with no traceable state under UNKNOWN and names them', async () => {
      prisma.statutoryConfig.findUnique.mockResolvedValue(config({ ptState: null }));
      prisma.payslip.findMany.mockResolvedValue([payslipC()]);

      const file = await service.professionalTaxChallan(TENANT, RUN_ID);

      expect(file.content.split('\n')[1]).toBe('UNKNOWN,1,200.00');
      expect(file.warnings).toEqual([
        'E003 (Chandra Iyer): no branch, employee or configured state; counted under UNKNOWN',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // Form 24Q annexure
  // -------------------------------------------------------------------------

  describe('form24Q', () => {
    it('adds up every run in the quarter the given run falls in', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
      prisma.payrollRun.findMany.mockResolvedValue([
        computedRun({ id: 'run-apr', month: 4 }),
        computedRun(),
      ]);
      prisma.payslip.findMany.mockResolvedValue([
        payslipA({ payrollRunId: 'run-apr' }),
        payslipA(),
      ]);

      const file = await service.form24Q(TENANT, RUN_ID);

      expect(file.content.split('\n')).toEqual([
        'PAN,Employee Name,Gross Salary Paid,Tax Deducted,Section Code',
        'ABCDE1234F,Asha Rao,60000.00,3000.00,92B',
      ]);
      expect(file.filename).toBe('form24q-annexure-Q1-2026-27.csv');
      expect(file.contentType).toBe('text/csv');
    });

    it('asks only for runs in that quarter, scoped by tenant', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
      prisma.payrollRun.findMany.mockResolvedValue([computedRun()]);
      prisma.payslip.findMany.mockResolvedValue([payslipA()]);

      await service.form24Q(TENANT, RUN_ID);

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT,
            OR: [
              { month: 4, year: 2026 },
              { month: 5, year: 2026 },
              { month: 6, year: 2026 },
            ],
          }),
        }),
      );
    });

    it('skips an employee with no PAN, since a return cannot carry them', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
      prisma.payrollRun.findMany.mockResolvedValue([computedRun()]);
      prisma.payslip.findMany.mockResolvedValue([payslipA(), payslipB()]);

      const file = await service.form24Q(TENANT, RUN_ID);

      expect(file.content.split('\n')).toHaveLength(2);
      expect(file.warnings).toEqual([
        'E002 (Bo, Jr Singh): skipped from Form 24Q, no PAN on record',
      ]);
    });

    it('still reports an employee whose tax for the quarter was nil', async () => {
      // A nil deductee belongs in the return; leaving them out breaks the
      // reconciliation against the salary paid.
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
      prisma.payrollRun.findMany.mockResolvedValue([computedRun()]);
      prisma.payslip.findMany.mockResolvedValue([payslipA({ tds: new Decimal(0) })]);

      const file = await service.form24Q(TENANT, RUN_ID);

      expect(file.content.split('\n')[1]).toBe('ABCDE1234F,Asha Rao,30000.00,0.00,92B');
    });

    it('labels the January to March run as Q4 of the same financial year', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun({ month: 2, year: 2027 }));
      prisma.payrollRun.findMany.mockResolvedValue([computedRun({ month: 2, year: 2027 })]);
      prisma.payslip.findMany.mockResolvedValue([payslipA()]);

      const file = await service.form24Q(TENANT, RUN_ID);

      expect(file.filename).toBe('form24q-annexure-Q4-2026-27.csv');
    });
  });

  // -------------------------------------------------------------------------
  // Bank transfer file
  // -------------------------------------------------------------------------

  describe('bankTransferFile', () => {
    beforeEach(() => {
      prisma.payrollRun.findFirst.mockResolvedValue(computedRun());
    });

    it('writes one payment instruction per employee', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipA(), payslipB()]);

      const file = await service.bankTransferFile(TENANT, RUN_ID);

      expect(file.content.split('\n')).toEqual([
        'Beneficiary Name,Account Number,IFSC,Amount,Reference',
        'Asha Rao,000123456789,HDFC0000123,27300.00,SAL-052026-E001',
        '"Bo, Jr Singh",000987654321,ICIC0000456,15265.00,SAL-052026-E002',
      ]);
      expect(file.filename).toBe('bank-transfer-052026.csv');
      expect(file.contentType).toBe('text/csv');
      expect(file.warnings).toEqual([]);
    });

    it('skips an employee with no bank details and names the missing field', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipA(), payslipC()]);

      const file = await service.bankTransferFile(TENANT, RUN_ID);

      expect(file.content.split('\n')).toHaveLength(2);
      expect(file.warnings).toEqual([
        'E003 (Chandra Iyer): skipped from the bank transfer file, no bank account number, no IFSC',
      ]);
    });

    it('skips a nil or negative net pay rather than instructing a zero transfer', async () => {
      prisma.payslip.findMany.mockResolvedValue([payslipA({ netPay: new Decimal(0) })]);

      const file = await service.bankTransferFile(TENANT, RUN_ID);

      expect(file.content.split('\n')).toHaveLength(1);
      expect(file.warnings).toEqual([
        'E001 (Asha Rao): skipped from the bank transfer file, net pay is not positive',
      ]);
    });
  });
});
