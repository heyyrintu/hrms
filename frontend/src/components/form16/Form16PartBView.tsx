'use client';

import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Download, CalendarX } from 'lucide-react';
import type { Form16PartB, QuarterlyTdsSummary } from '@/types';
import { formatINR, isNegativeAmount } from './money';
import { QuarterlyTdsTable } from './QuarterlyTdsTable';
import { Form16Notes } from './Form16Notes';

interface Form16PartBViewProps {
  certificate: Form16PartB;
  /** The quarterly summary, when it was fetched; it carries its own notes. */
  quarterly: QuarterlyTdsSummary | null;
  onDownload: () => void;
  downloading: boolean;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Formats an ISO date without constructing a Date, which would shift the day
 * across timezones. "2026-04-01" reads as "01 Apr 2026" everywhere.
 */
function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const monthIndex = Number(match[2]) - 1;
  const month = MONTHS_SHORT[monthIndex] ?? match[2];
  return `${match[3]} ${month} ${match[1]}`;
}

interface LineRowProps {
  label: string;
  value: string;
  /** Sub-items of a numbered line, such as 16(ia) or 80C. */
  indented?: boolean;
  emphasis?: boolean;
}

function LineRow({ label, value, indented = false, emphasis = false }: LineRowProps) {
  const negative = isNegativeAmount(value);
  const labelClass = [
    'text-sm',
    indented ? 'pl-6 text-warm-600' : 'text-warm-800',
    emphasis ? 'font-semibold text-warm-900' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const valueClass = [
    'text-sm tabular-nums text-right',
    negative ? 'text-red-700' : 'text-warm-900',
    emphasis ? 'font-bold' : 'font-medium',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={`flex items-start justify-between gap-4 py-2 ${
        emphasis ? 'border-t border-warm-200' : 'border-t border-warm-50'
      }`}
    >
      <span className={labelClass}>{label}</span>
      <span className={valueClass}>{formatINR(value)}</span>
    </div>
  );
}

function FactPair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-warm-500">{label}</p>
      <p className="text-sm font-medium text-warm-900 mt-0.5">{value}</p>
    </div>
  );
}

/**
 * Part B of Form 16, rendered as the numbered lines the statutory form uses so
 * an employee can read it against the form they know.
 */
export function Form16PartBView({
  certificate,
  quarterly,
  onDownload,
  downloading,
}: Form16PartBViewProps) {
  const section16 = certificate.deductionsSection16;
  const chapterVIA = certificate.deductionsChapterVIA;
  const quarters = quarterly?.quarters ?? certificate.quarterlyTds;
  const notes = [...certificate.notes, ...(quarterly?.notes ?? [])];

  return (
    <div className="space-y-6">
      {/* Who, for what period, under which regime */}
      <Card>
        <CardContent className="py-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-warm-500">Certificate</p>
              <h2 className="text-lg font-bold text-warm-900">
                Form 16 Part B — {certificate.financialYearLabel}
              </h2>
              <p className="text-sm text-warm-600 mt-1">
                {certificate.employee.name} ({certificate.employee.employeeCode}) ·{' '}
                {certificate.assessmentYear}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={certificate.regime === 'NEW' ? 'info' : 'gray'}>
                {certificate.regime === 'NEW' ? 'New regime' : 'Old regime'}
              </Badge>
              <Button onClick={onDownload} loading={downloading} disabled={downloading}>
                <Download className="w-4 h-4 mr-2" />
                Download Part B (PDF)
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-3 border-t border-warm-100">
            <FactPair label="Employer" value={certificate.employer.name} />
            <FactPair label="Employer TAN" value={certificate.employer.tan ?? 'Not on record'} />
            <FactPair label="Employee PAN" value={certificate.employee.pan ?? 'Not on record'} />
            <FactPair
              label="Period"
              value={`${formatIsoDate(certificate.periodFrom)} to ${formatIsoDate(certificate.periodTo)}`}
            />
          </div>
        </CardContent>
      </Card>

      {/* A year with no payslips is a valid answer, not a failure */}
      {!certificate.hasPayslipsInYear && (
        <div className="rounded-xl border border-warm-200 bg-warm-50 p-4">
          <div className="flex items-start gap-3">
            <CalendarX className="w-5 h-5 text-warm-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-warm-900">
                No payslips in this financial year
              </p>
              <p className="text-sm text-warm-600 mt-1">
                There is no processed payslip for {certificate.employee.name} in{' '}
                {certificate.financialYearLabel}, so every figure below is nil. This is not an error:
                it usually means employment had not started, or had already ended, before the year
                began.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* The numbered statutory lines */}
      <Card>
        <CardContent className="py-4">
          <h2 className="text-base font-semibold text-warm-900 mb-2">
            Part B — details of salary paid and tax deducted
          </h2>

          <LineRow label="1. Gross salary" value={certificate.grossSalary} />
          <LineRow
            label="2. Less: allowances exempt under section 10"
            value={certificate.allowancesExemptSection10}
          />
          <LineRow label="3. Balance" value={certificate.balance} />

          <LineRow label="4. Deductions under section 16" value={section16.total} />
          <LineRow
            label="(a) Standard deduction [section 16(ia)]"
            value={section16.standardDeduction}
            indented
          />
          <LineRow
            label="(b) Professional tax [section 16(iii)]"
            value={section16.professionalTax}
            indented
          />

          <LineRow
            label='5. Income chargeable under the head "Salaries"'
            value={certificate.incomeChargeableUnderSalaries}
            emphasis
          />

          <LineRow
            label="6(a). Income under any other head offered for TDS"
            value={certificate.otherIncome}
          />
          <LineRow
            label="6(b). Income from house property"
            value={certificate.incomeFromHouseProperty}
          />

          <LineRow label="7. Gross total income" value={certificate.grossTotalIncome} emphasis />

          <LineRow label="8. Deductions under Chapter VI-A" value={chapterVIA.total} />
          <LineRow label="(a) Section 80C" value={chapterVIA.section80C} indented />
          <LineRow label="(b) Section 80D" value={chapterVIA.section80D} indented />
          <LineRow label="(c) Section 80CCD(1B)" value={chapterVIA.section80CCD1B} indented />
          <LineRow
            label="(d) Section 80CCD(2), employer contribution to NPS"
            value={chapterVIA.section80CCD2}
            indented
          />
          <LineRow label="(e) Other deductions" value={chapterVIA.otherDeductions} indented />

          <LineRow label="9. Total income" value={certificate.totalIncome} emphasis />
          <LineRow label="10. Tax on total income" value={certificate.taxOnTotalIncome} />
          <LineRow label="11. Rebate under section 87A" value={certificate.rebateSection87A} />
          <LineRow label="12. Surcharge" value={certificate.surcharge} />
          <LineRow
            label="13. Health and education cess"
            value={certificate.healthAndEducationCess}
          />
          <LineRow label="14. Total tax payable" value={certificate.totalTaxPayable} emphasis />

          <LineRow
            label="15(a). Tax deducted at source by this employer"
            value={certificate.taxDeductedByEmployer}
          />
          <LineRow
            label="15(b). Tax deducted by a previous employer"
            value={certificate.taxDeductedByPreviousEmployer}
          />
          <LineRow label="15. Total tax deducted" value={certificate.totalTaxDeducted} emphasis />

          <LineRow label="Balance tax payable" value={certificate.balanceTaxPayable} emphasis />
          <LineRow label="Refund due" value={certificate.refundDue} emphasis />

          <p className="text-xs text-warm-500 mt-3">
            For information only: the employee&apos;s own provident fund contribution for the year
            was {formatINR(certificate.providentFundEmployeeContribution)}. It is not a separate line
            on the form; it usually forms part of the amount claimed under section 80C.
          </p>
        </CardContent>
      </Card>

      {/* Quarterly TDS, with the always-empty TRACES receipt column */}
      <Card>
        <CardContent className="py-4">
          <QuarterlyTdsTable
            quarters={quarters}
            totalAmountPaid={quarterly?.totalAmountPaid}
            totalTaxDeducted={quarterly?.totalTaxDeducted}
          />
        </CardContent>
      </Card>

      <Form16Notes notes={notes} />
    </div>
  );
}
