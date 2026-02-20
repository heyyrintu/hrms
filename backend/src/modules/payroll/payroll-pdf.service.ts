import { Injectable } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';

interface PayslipForPdf {
  id: string;
  workingDays: number;
  presentDays: number;
  leaveDays: number;
  lopDays: number;
  otHours: number | string;
  basePay: number | string;
  earnings: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  grossPay: number | string;
  totalDeductions: number | string;
  netPay: number | string;
  otPay: number | string;
  employee?: {
    firstName: string;
    lastName: string;
    employeeCode: string;
    email?: string;
    designation?: string;
    department?: { name: string };
    joinDate?: Date | string;
  };
  payrollRun?: {
    month: number;
    year: number;
    status: string;
  };
}

const MONTH_NAMES = [
  '',
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

@Injectable()
export class PayrollPdfService {
  async generatePayslipPdf(payslip: PayslipForPdf): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const formatCurrency = (val: number | string) =>
        `INR ${Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

      const month = payslip.payrollRun?.month ?? 0;
      const year = payslip.payrollRun?.year ?? '';
      const periodLabel = `${MONTH_NAMES[month]} ${year}`;
      const emp = payslip.employee;

      // ── Header ──────────────────────────────────────────────────────────
      doc
        .rect(0, 0, doc.page.width, 80)
        .fill('#1a56db');

      doc
        .fillColor('#ffffff')
        .fontSize(20)
        .font('Helvetica-Bold')
        .text('PAYSLIP', 50, 25, { align: 'center' });

      doc
        .fontSize(11)
        .font('Helvetica')
        .text(periodLabel, 50, 52, { align: 'center' });

      doc.fillColor('#111827');

      // ── Employee Info ────────────────────────────────────────────────────
      const infoY = 100;

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(`${emp?.firstName ?? ''} ${emp?.lastName ?? ''}`, 50, infoY);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#6b7280');

      const infoRows = [
        ['Employee Code', emp?.employeeCode ?? '-'],
        ['Department', emp?.department?.name ?? '-'],
        ['Designation', emp?.designation ?? '-'],
        ['Email', emp?.email ?? '-'],
      ];

      let infoLeft = infoY + 22;
      for (const [label, value] of infoRows) {
        doc
          .font('Helvetica-Bold')
          .fillColor('#374151')
          .text(label + ':', 50, infoLeft, { continued: true, width: 120 })
          .font('Helvetica')
          .fillColor('#6b7280')
          .text(` ${value}`);
        infoLeft += 16;
      }

      // Right side: attendance summary
      const attRows = [
        ['Working Days', String(payslip.workingDays)],
        ['Present Days', String(payslip.presentDays)],
        ['Leave Days', String(payslip.leaveDays)],
        ['LOP Days', String(payslip.lopDays)],
        ['OT Hours', String(Number(payslip.otHours).toFixed(2))],
      ];

      let attLeft = infoY + 22;
      for (const [label, value] of attRows) {
        doc
          .font('Helvetica-Bold')
          .fillColor('#374151')
          .text(label + ':', 320, attLeft, { continued: true, width: 120 })
          .font('Helvetica')
          .fillColor('#6b7280')
          .text(` ${value}`);
        attLeft += 16;
      }

      doc.fillColor('#111827');

      // ── Divider ──────────────────────────────────────────────────────────
      const dividerY = infoLeft + 12;
      doc.moveTo(50, dividerY).lineTo(545, dividerY).strokeColor('#e5e7eb').lineWidth(1).stroke();

      // ── Earnings & Deductions Tables ─────────────────────────────────────
      const tableTop = dividerY + 16;
      const colW = 230;

      // Table headers
      const drawTableHeader = (x: number, y: number, title: string, color: string) => {
        doc
          .rect(x, y, colW, 22)
          .fill(color);
        doc
          .fillColor('#ffffff')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(title, x + 8, y + 6, { width: colW - 16 });
      };

      const drawRow = (
        x: number,
        y: number,
        label: string,
        amount: number | string,
        bold = false,
        bgColor?: string,
      ) => {
        if (bgColor) {
          doc.rect(x, y, colW, 20).fill(bgColor);
        }
        doc
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fillColor(bold ? '#111827' : '#374151')
          .fontSize(9.5)
          .text(label, x + 8, y + 5, { width: colW - 80 })
          .text(formatCurrency(Number(amount)), x + colW - 100, y + 5, {
            width: 92,
            align: 'right',
          });
      };

      // Earnings column
      drawTableHeader(50, tableTop, 'EARNINGS', '#1a56db');
      let earningsY = tableTop + 22;

      drawRow(50, earningsY, 'Base Pay', payslip.basePay, false, '#f9fafb');
      earningsY += 20;

      for (const e of payslip.earnings as { name: string; amount: number }[]) {
        const bg = earningsY % 40 === 0 ? '#f9fafb' : undefined;
        drawRow(50, earningsY, e.name, e.amount, false, bg);
        earningsY += 20;
      }

      if (Number(payslip.otPay) > 0) {
        drawRow(50, earningsY, `OT Pay (${Number(payslip.otHours).toFixed(1)}h)`, payslip.otPay, false);
        earningsY += 20;
      }

      // Gross pay separator
      doc.moveTo(50, earningsY).lineTo(50 + colW, earningsY).strokeColor('#d1d5db').lineWidth(0.5).stroke();
      earningsY += 2;
      drawRow(50, earningsY, 'Gross Pay', payslip.grossPay, true, '#eff6ff');
      earningsY += 20;

      // Deductions column
      drawTableHeader(320, tableTop, 'DEDUCTIONS', '#dc2626');
      let deductionsY = tableTop + 22;

      const deductions = payslip.deductions as { name: string; amount: number }[];
      if (deductions.length === 0) {
        doc
          .font('Helvetica')
          .fillColor('#9ca3af')
          .fontSize(9.5)
          .text('No deductions', 328, deductionsY + 5);
        deductionsY += 20;
      } else {
        for (const d of deductions) {
          const bg = deductionsY % 40 === 0 ? '#f9fafb' : undefined;
          drawRow(320, deductionsY, d.name, d.amount, false, bg);
          deductionsY += 20;
        }
      }

      doc.moveTo(320, deductionsY).lineTo(320 + colW, deductionsY).strokeColor('#d1d5db').lineWidth(0.5).stroke();
      deductionsY += 2;
      drawRow(320, deductionsY, 'Total Deductions', payslip.totalDeductions, true, '#fff5f5');
      deductionsY += 20;

      // ── Net Pay ──────────────────────────────────────────────────────────
      const netY = Math.max(earningsY, deductionsY) + 20;
      doc
        .rect(50, netY, 495, 40)
        .fill('#065f46');
      doc
        .font('Helvetica-Bold')
        .fillColor('#ffffff')
        .fontSize(13)
        .text('NET PAY', 60, netY + 12, { continued: true, width: 200 })
        .text(formatCurrency(payslip.netPay), 60, netY + 12, {
          width: 475,
          align: 'right',
        });

      // ── Footer ───────────────────────────────────────────────────────────
      const footerY = netY + 60;
      doc
        .moveTo(50, footerY)
        .lineTo(545, footerY)
        .strokeColor('#e5e7eb')
        .lineWidth(0.5)
        .stroke();

      doc
        .font('Helvetica')
        .fillColor('#9ca3af')
        .fontSize(8)
        .text(
          `Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}  ·  This is a computer-generated document.`,
          50,
          footerY + 8,
          { align: 'center', width: 495 },
        );

      doc.end();
    });
  }
}
