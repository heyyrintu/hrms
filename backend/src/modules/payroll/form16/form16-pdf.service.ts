import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { Decimal } from '@prisma/client/runtime/library';
import { Form16PartB } from './form16.service';

/**
 * Renders the Part B annexure as a PDF.
 *
 * The document deliberately identifies itself as the Part B annexure in its
 * title, its subtitle and its footer. Part A is generated and digitally signed
 * by the Income Tax Department on TRACES; this file cannot produce it and must
 * not be mistaken for it, so the caveat is printed where a reader cannot miss
 * it rather than buried in a note at the end.
 *
 * Layout follows `payroll-pdf.service.ts`: PDFKit, A4, the same palette, the
 * same buffer-collecting promise.
 */

const PAGE_BOTTOM = 780;
const LEFT = 50;
const RIGHT = 545;
const WIDTH = RIGHT - LEFT;

@Injectable()
export class Form16PdfService {
  async generatePartBPdf(form16: Form16PartB): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const money = (val: Decimal) =>
        Number(val.toFixed(2)).toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

      /** Starts a fresh page when the next block would run off this one. */
      const ensureRoom = (y: number, needed: number): number => {
        if (y + needed <= PAGE_BOTTOM) return y;
        doc.addPage();
        return 50;
      };

      // ── Header ───────────────────────────────────────────────────────────
      doc.rect(0, 0, doc.page.width, 86).fill('#1a56db');

      doc
        .fillColor('#ffffff')
        .fontSize(18)
        .font('Helvetica-Bold')
        .text('FORM 16 — PART B', LEFT, 20, { align: 'center', width: WIDTH });

      doc
        .fontSize(9)
        .font('Helvetica')
        .text(
          'Annexure to the certificate under section 203 of the Income-tax Act, 1961',
          LEFT,
          44,
          { align: 'center', width: WIDTH },
        );

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .text(
          'Prepared from employer payroll records. Part A is issued by TRACES and is not reproduced here.',
          LEFT,
          62,
          { align: 'center', width: WIDTH },
        );

      doc.fillColor('#111827');

      // ── Employer / employee blocks ───────────────────────────────────────
      let y = 104;

      const block = (
        x: number,
        title: string,
        rows: [string, string][],
        startY: number,
      ): number => {
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#1a56db')
          .text(title, x, startY);

        let rowY = startY + 14;
        for (const [label, value] of rows) {
          doc
            .font('Helvetica-Bold')
            .fillColor('#374151')
            .fontSize(8.5)
            .text(`${label}:`, x, rowY, { width: 70 });
          doc
            .font('Helvetica')
            .fillColor('#6b7280')
            .text(value || '-', x + 72, rowY, { width: 165 });
          rowY = Math.max(doc.y, rowY + 12);
        }
        return rowY;
      };

      const employerBottom = block(
        LEFT,
        'EMPLOYER (DEDUCTOR)',
        [
          ['Name', form16.employer.name],
          ['Address', form16.employer.address],
          ['TAN', form16.employer.tan ?? 'NOT ON RECORD'],
          ['PAN', form16.employer.pan ?? 'NOT ON RECORD'],
        ],
        y,
      );

      const employeeBottom = block(
        320,
        'EMPLOYEE (DEDUCTEE)',
        [
          ['Name', form16.employee.name],
          ['Code', form16.employee.employeeCode],
          ['Designation', form16.employee.designation ?? '-'],
          ['PAN', form16.employee.pan ?? 'NOT ON RECORD'],
        ],
        y,
      );

      y = Math.max(employerBottom, employeeBottom) + 8;

      // ── Year and period strip ────────────────────────────────────────────
      doc.rect(LEFT, y, WIDTH, 24).fill('#eff6ff');
      doc
        .font('Helvetica-Bold')
        .fillColor('#1e3a8a')
        .fontSize(8.5)
        .text(
          `Financial Year: ${form16.financialYearLabel}     ` +
            `Assessment Year: ${form16.assessmentYear}     ` +
            `Period: ${form16.periodFrom} to ${form16.periodTo}     ` +
            `Regime: ${form16.regime}`,
          LEFT + 10,
          y + 8,
          { width: WIDTH - 20 },
        );

      y += 36;

      // ── The numbered breakdown ───────────────────────────────────────────
      doc.rect(LEFT, y, WIDTH, 22).fill('#1a56db');
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text('DETAILS OF SALARY PAID AND TAX DEDUCTED', LEFT + 8, y + 6)
        .text('Amount (INR)', RIGHT - 130, y + 6, { width: 122, align: 'right' });
      y += 22;

      const line = (
        no: string,
        label: string,
        amount: Decimal | null,
        opts: { bold?: boolean; indent?: number; band?: string } = {},
      ) => {
        y = ensureRoom(y, 20);
        if (opts.band) doc.rect(LEFT, y, WIDTH, 18).fill(opts.band);

        const indent = opts.indent ?? 0;
        doc
          .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(opts.bold ? '#111827' : '#374151')
          .fontSize(8.5)
          .text(no, LEFT + 6 + indent, y + 5, { width: 24 })
          .text(label, LEFT + 30 + indent, y + 5, { width: WIDTH - 170 - indent });

        if (amount !== null) {
          doc.text(money(amount), RIGHT - 130, y + 5, { width: 122, align: 'right' });
        }
        y += 18;
      };

      const s16 = form16.deductionsSection16;
      const via = form16.deductionsChapterVIA;

      line('1.', 'Gross salary', form16.grossSalary, { bold: true, band: '#f9fafb' });
      line('2.', 'Less: allowances exempt under section 10', form16.allowancesExemptSection10);
      line('3.', 'Balance (1 - 2)', form16.balance, { bold: true, band: '#f9fafb' });
      line('4.', 'Deductions under section 16', s16.total, { bold: true });
      line('', '(a) Standard deduction — section 16(ia)', s16.standardDeduction, { indent: 14 });
      line('', '(b) Tax on employment — section 16(iii)', s16.professionalTax, { indent: 14 });
      line('5.', 'Income chargeable under the head "Salaries" (3 - 4)', form16.incomeChargeableUnderSalaries, {
        bold: true,
        band: '#f9fafb',
      });
      line('6.', 'Add: any other income reported by the employee', null);
      line('', '(a) Income from house property', form16.incomeFromHouseProperty, { indent: 14 });
      line('', '(b) Income under any other head', form16.otherIncome, { indent: 14 });
      line('7.', 'Gross total income (5 + 6)', form16.grossTotalIncome, {
        bold: true,
        band: '#f9fafb',
      });
      line('8.', 'Deductions under Chapter VI-A', via.total, { bold: true });
      line('', '(a) Section 80C', via.section80C, { indent: 14 });
      line('', '(b) Section 80D', via.section80D, { indent: 14 });
      line('', '(c) Section 80CCD(1B)', via.section80CCD1B, { indent: 14 });
      line('', '(d) Section 80CCD(2) — employer contribution to NPS', via.section80CCD2, { indent: 14 });
      line('', '(e) Other deductions', via.otherDeductions, { indent: 14 });
      line('9.', 'Total income (7 - 8)', form16.totalIncome, { bold: true, band: '#eff6ff' });
      line('10.', 'Tax on total income', form16.taxOnTotalIncome);
      line('11.', 'Less: rebate under section 87A', form16.rebateSection87A);
      line('12.', 'Add: surcharge', form16.surcharge);
      line('13.', 'Add: health and education cess', form16.healthAndEducationCess);
      line('14.', 'Total tax payable', form16.totalTaxPayable, { bold: true, band: '#eff6ff' });
      line('15.', 'Less: total tax deducted at source', form16.totalTaxDeducted, { bold: true });
      line('', '(a) By this employer', form16.taxDeductedByEmployer, { indent: 14 });
      line('', '(b) Reported as deducted by a previous employer', form16.taxDeductedByPreviousEmployer, {
        indent: 14,
      });

      y = ensureRoom(y, 30);
      doc.rect(LEFT, y, WIDTH, 24).fill(form16.refundDue.gt(0) ? '#065f46' : '#7f1d1d');
      doc
        .font('Helvetica-Bold')
        .fillColor('#ffffff')
        .fontSize(10)
        .text(
          form16.refundDue.gt(0) ? 'REFUND DUE ON ASSESSMENT' : 'BALANCE TAX PAYABLE',
          LEFT + 8,
          y + 7,
        )
        .text(
          money(form16.refundDue.gt(0) ? form16.refundDue : form16.balanceTaxPayable),
          RIGHT - 130,
          y + 7,
          { width: 122, align: 'right' },
        );
      y += 36;

      // ── Quarterly deduction summary ──────────────────────────────────────
      y = ensureRoom(y, 130);
      doc.rect(LEFT, y, WIDTH, 22).fill('#374151');
      doc
        .fillColor('#ffffff')
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text('TAX DEDUCTED BY QUARTER (WORKING SUMMARY — NOT A TRACES CERTIFICATE)', LEFT + 8, y + 6);
      y += 22;

      doc
        .font('Helvetica-Bold')
        .fillColor('#374151')
        .fontSize(8)
        .text('Quarter', LEFT + 8, y + 5, { width: 52 })
        .text('Months', LEFT + 62, y + 5, { width: 150 })
        .text('Amount paid', 280, y + 5, { width: 95, align: 'right' })
        .text('Tax deducted', 385, y + 5, { width: 95, align: 'right' })
        .text('Receipt no.', 490, y + 5, { width: 55, align: 'right' });
      y += 18;

      for (const q of form16.quarterlyTds) {
        y = ensureRoom(y, 20);
        doc
          .font('Helvetica')
          .fillColor('#374151')
          .fontSize(8.5)
          .text(q.quarter, LEFT + 8, y + 4, { width: 52 })
          .text(q.months.join(', '), LEFT + 62, y + 4, { width: 150 })
          .text(money(q.amountPaid), 280, y + 4, { width: 95, align: 'right' })
          .text(money(q.taxDeducted), 385, y + 4, { width: 95, align: 'right' })
          // Deliberately blank: only TRACES issues this number.
          .fillColor('#9ca3af')
          .text('—', 490, y + 4, { width: 55, align: 'right' });
        y += 17;
      }

      doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor('#d1d5db').lineWidth(0.5).stroke();
      y += 4;
      doc
        .font('Helvetica-Bold')
        .fillColor('#111827')
        .fontSize(8.5)
        .text('Total', LEFT + 8, y, { width: 200 })
        .text(
          money(
            form16.quarterlyTds.reduce((sum, q) => sum.add(q.amountPaid), new Decimal(0)),
          ),
          280,
          y,
          { width: 95, align: 'right' },
        )
        .text(money(form16.taxDeductedByEmployer), 385, y, { width: 95, align: 'right' });
      y += 24;

      // ── Notes ────────────────────────────────────────────────────────────
      y = ensureRoom(y, 60);
      doc
        .font('Helvetica-Bold')
        .fillColor('#7f1d1d')
        .fontSize(9)
        .text('NOTES AND LIMITATIONS', LEFT, y);
      y += 14;

      for (const note of form16.notes) {
        y = ensureRoom(y, 30);
        doc
          .font('Helvetica')
          .fillColor('#4b5563')
          .fontSize(7.5)
          .text(`•  ${note}`, LEFT, y, { width: WIDTH, align: 'left' });
        y = doc.y + 4;
      }

      // ── Footer ───────────────────────────────────────────────────────────
      y = ensureRoom(y, 40);
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      doc
        .font('Helvetica')
        .fillColor('#9ca3af')
        .fontSize(7.5)
        .text(
          `Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}  ·  ` +
            'Computer-generated Part B annexure, unsigned.  ·  ' +
            'The certificate under section 203 must be downloaded from TRACES.',
          LEFT,
          y + 8,
          { align: 'center', width: WIDTH },
        );

      doc.end();
    });
  }
}
