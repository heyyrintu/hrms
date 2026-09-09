import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import { Form16PdfService } from './form16-pdf.service';
import { Form16PartB, Form16Quarter } from './form16.service';

function quarter(q: Form16Quarter['quarter'], tax: number): Form16Quarter {
  return {
    quarter: q,
    months: ['April', 'May', 'June'],
    amountPaid: new Decimal(300000),
    taxDeducted: new Decimal(tax),
    payslipCount: 3,
    tracesReceiptNumber: null,
  };
}

function partB(overrides: Partial<Form16PartB> = {}): Form16PartB {
  const d = (n: number) => new Decimal(n);

  return {
    financialYear: 2025,
    financialYearLabel: '2025-26',
    assessmentYear: '2026-27',
    periodFrom: '2025-04-01',
    periodTo: '2026-03-31',
    regime: 'OLD' as never,
    employer: {
      name: 'Drona Logitech Private Limited',
      address: '12 MG Road, Bengaluru, Karnataka, 560001, India',
      tan: 'BLRD12345E',
      pan: 'AAACD1234E',
    },
    employee: {
      id: 'emp-1',
      name: 'Asha Rao',
      employeeCode: 'E001',
      pan: 'ABCDE1234F',
      designation: 'Engineer',
    },
    hasPayslipsInYear: true,
    payslipCount: 12,
    grossSalary: d(1200000),
    allowancesExemptSection10: d(120000),
    balance: d(1080000),
    deductionsSection16: {
      standardDeduction: d(50000),
      professionalTax: d(2400),
      total: d(52400),
    },
    incomeChargeableUnderSalaries: d(1027600),
    otherIncome: d(0),
    incomeFromHouseProperty: d(0),
    grossTotalIncome: d(1027600),
    deductionsChapterVIA: {
      section80C: d(150000),
      section80D: d(25000),
      section80CCD1B: d(50000),
      section80CCD2: d(0),
      otherDeductions: d(0),
      total: d(225000),
    },
    totalIncome: d(802600),
    taxOnTotalIncome: d(73020),
    rebateSection87A: d(0),
    surcharge: d(0),
    healthAndEducationCess: d(2921),
    totalTaxPayable: d(75941),
    taxDeductedByEmployer: d(60000),
    taxDeductedByPreviousEmployer: d(0),
    totalTaxDeducted: d(60000),
    balanceTaxPayable: d(15941),
    refundDue: d(0),
    providentFundEmployeeContribution: d(21600),
    quarterlyTds: [
      quarter('Q1', 15000),
      quarter('Q2', 15000),
      quarter('Q3', 15000),
      quarter('Q4', 15000),
    ],
    notes: ['This is the Part B annexure, not the TRACES-issued certificate.'],
    ...overrides,
  };
}

describe('Form16PdfService', () => {
  let service: Form16PdfService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [Form16PdfService],
    }).compile();

    service = module.get<Form16PdfService>(Form16PdfService);
  });

  it('produces a PDF buffer', async () => {
    const buffer = await service.generatePartBPdf(partB());

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('renders a nil certificate without falling over on the zeroes', async () => {
    const zero = new Decimal(0);
    const buffer = await service.generatePartBPdf(
      partB({
        hasPayslipsInYear: false,
        payslipCount: 0,
        grossSalary: zero,
        allowancesExemptSection10: zero,
        balance: zero,
        incomeChargeableUnderSalaries: zero,
        grossTotalIncome: zero,
        totalIncome: zero,
        taxOnTotalIncome: zero,
        healthAndEducationCess: zero,
        totalTaxPayable: zero,
        taxDeductedByEmployer: zero,
        totalTaxDeducted: zero,
        balanceTaxPayable: zero,
        refundDue: zero,
        quarterlyTds: [
          quarter('Q1', 0),
          quarter('Q2', 0),
          quarter('Q3', 0),
          quarter('Q4', 0),
        ],
      }),
    );

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders a negative house property income without breaking the layout', async () => {
    const buffer = await service.generatePartBPdf(
      partB({ incomeFromHouseProperty: new Decimal(-200000) }),
    );

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('survives a long list of notes by paginating', async () => {
    const buffer = await service.generatePartBPdf(
      partB({ notes: Array.from({ length: 25 }, (_, i) => `Note ${i}: ${'x'.repeat(300)}`) }),
    );

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders the refund case as well as the shortfall case', async () => {
    const buffer = await service.generatePartBPdf(
      partB({
        balanceTaxPayable: new Decimal(0),
        refundDue: new Decimal(20059),
        totalTaxDeducted: new Decimal(96000),
      }),
    );

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders when the identifiers are missing, so the gap is visible on paper', async () => {
    const buffer = await service.generatePartBPdf(
      partB({
        employer: {
          name: 'Drona Logitech Private Limited',
          address: '',
          tan: null,
          pan: null,
        },
        employee: {
          id: 'emp-1',
          name: 'Asha Rao',
          employeeCode: 'E001',
          pan: null,
          designation: null,
        },
      }),
    );

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
