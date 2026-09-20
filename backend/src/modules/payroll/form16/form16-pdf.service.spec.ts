import { Test, TestingModule } from '@nestjs/testing';
import { Decimal } from '@prisma/client/runtime/library';
import * as zlib from 'zlib';
import { Form16PdfService } from './form16-pdf.service';
import { Form16PartB, Form16Quarter } from './form16.service';
import { Section10ExemptionEntry } from '../statutory/statutory.calculators';

/**
 * Recovers the words PDFKit drew, for asserting on rendered content the way
 * `payroll-pdf.service.spec.ts`-style tests would if this codebase had one.
 *
 * PDFKit writes each page's content as a Flate-compressed stream of text
 * operators, showing text as hex strings inside `TJ`/`Tj`, e.g.
 * `[<48656c6c6f> 0] TJ`. Decoding every hex run in document order and
 * concatenating the bytes reconstructs the words for the plain Helvetica
 * text this service renders (WinAnsi bytes are ASCII for the characters used
 * here). This only proves text is present, not its on-page position — a
 * genuine visual check still needs the PDF opened and read.
 */
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1');
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let streamMatch: RegExpExecArray | null;
  let decompressed = '';
  while ((streamMatch = streamRe.exec(raw))) {
    try {
      decompressed += zlib.inflateSync(Buffer.from(streamMatch[1], 'latin1')).toString('latin1');
    } catch {
      // Not a Flate stream (e.g. an embedded font program) — skip it.
    }
  }

  let text = '';
  const hexRe = /<([0-9A-Fa-f]+)>/g;
  let hexMatch: RegExpExecArray | null;
  while ((hexMatch = hexRe.exec(decompressed))) {
    text += Buffer.from(hexMatch[1], 'hex').toString('latin1');
  }
  return text;
}

function section10Entry(
  overrides: Partial<Section10ExemptionEntry> = {},
): Section10ExemptionEntry {
  return {
    head: 'HRA',
    declared: new Decimal(0),
    limit: null,
    allowed: new Decimal(0),
    disallowed: new Decimal(0),
    paidByEmployer: null,
    ltaBlock: null,
    limitedBy: 'DECLARED',
    ...overrides,
  };
}

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

  describe('section 10 breakdown beneath line 2', () => {
    it('shows each head that has a figure, allowed amount included', async () => {
      const buffer = await service.generatePartBPdf(
        partB({
          allowancesExemptSection10Breakdown: [
            section10Entry({ head: 'HRA', declared: new Decimal(96000), allowed: new Decimal(96000) }),
            section10Entry({
              head: 'LTA',
              declared: new Decimal(18000),
              allowed: new Decimal(18000),
            }),
          ],
        }),
      );

      const text = extractPdfText(buffer);
      expect(text).toContain('House rent allowance');
      expect(text).toContain('96,000.00');
      expect(text).toContain('Leave travel allowance');
      expect(text).toContain('18,000.00');
    });

    it('shows both the declared and the allowed figure where a head was trimmed to a ceiling', async () => {
      const buffer = await service.generatePartBPdf(
        partB({
          allowancesExemptSection10Breakdown: [
            section10Entry({
              head: 'CHILDREN_EDUCATION',
              declared: new Decimal(5000),
              limit: new Decimal(1200),
              allowed: new Decimal(1200),
              disallowed: new Decimal(3800),
            }),
          ],
        }),
      );

      const text = extractPdfText(buffer);
      expect(text).toContain("Children's education allowance");
      // Both figures must appear: what was declared and what survived the cap.
      expect(text).toContain('5,000.00');
      expect(text).toContain('1,200.00');
    });

    it('leaves out a head with nothing declared and nothing allowed', async () => {
      const buffer = await service.generatePartBPdf(
        partB({
          allowancesExemptSection10Breakdown: [
            section10Entry({ head: 'HRA', declared: new Decimal(96000), allowed: new Decimal(96000) }),
            section10Entry({ head: 'LTA' }), // nil: declared 0, allowed 0
            section10Entry({ head: 'HOSTEL_ALLOWANCE' }), // nil too
          ],
        }),
      );

      const text = extractPdfText(buffer);
      expect(text).toContain('House rent allowance');
      expect(text).not.toContain('Leave travel allowance');
      expect(text).not.toContain('Hostel allowance');
    });

    it('renders exactly as before when there is no section 10 breakdown at all', async () => {
      const buffer = await service.generatePartBPdf(partB());

      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
      const text = extractPdfText(buffer);
      expect(text).not.toContain('House rent allowance');
      expect(text).not.toContain('Leave travel allowance');
      expect(text).not.toContain("Children's education allowance");
      expect(text).not.toContain('Hostel allowance');
      // Line 2 itself is unaffected either way.
      expect(text).toContain('Less: allowances exempt under section 10');
    });

    it('does not collide with the line above or below it', async () => {
      const buffer = await service.generatePartBPdf(
        partB({
          allowancesExemptSection10Breakdown: [
            section10Entry({ head: 'HRA', declared: new Decimal(96000), allowed: new Decimal(96000) }),
            section10Entry({
              head: 'CHILDREN_EDUCATION',
              declared: new Decimal(5000),
              limit: new Decimal(1200),
              allowed: new Decimal(1200),
              disallowed: new Decimal(3800),
            }),
            section10Entry({
              head: 'HOSTEL_ALLOWANCE',
              declared: new Decimal(9000),
              limit: new Decimal(7200),
              allowed: new Decimal(7200),
              disallowed: new Decimal(1800),
            }),
          ],
        }),
      );

      const text = extractPdfText(buffer);
      // Line 2 and line 3 must both still be present, in order, with the new
      // breakdown rows between them rather than merged into either line.
      const line2 = text.indexOf('Less: allowances exempt under section 10');
      const line3 = text.indexOf('Balance (1 - 2)');
      expect(line2).toBeGreaterThan(-1);
      expect(line3).toBeGreaterThan(line2);
      expect(text.slice(line2, line3)).toContain('House rent allowance');
      expect(text.slice(line2, line3)).toContain("Children's education allowance");
      expect(text.slice(line2, line3)).toContain('Hostel allowance');
    });
  });
});
