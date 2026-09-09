import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { PayrollRunStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Statutory return and challan file writers.
 *
 * Every figure these emit is read back from payslips that payroll already
 * computed; nothing is recalculated here. That is deliberate — a return must
 * agree with what was paid and what the payslip told the employee, so
 * recomputing would only create a second answer to the same question.
 *
 * HONESTY NOTE, and it matters because these are filing artefacts: the layouts
 * below are built from the published field lists for each return, but the
 * authorities revise their templates and validation utilities without much
 * notice, and some particulars (establishment codes, contribution periods,
 * challan identification numbers) live outside this system entirely. Treat
 * every file as a draft to be checked against the current portal template by
 * whoever signs the return. Specific uncertainties are called out on each
 * method rather than buried here.
 */

/** What a caller gets back: enough to stream a download, plus what was left out. */
export interface GeneratedReturnFile {
  filename: string;
  contentType: string;
  content: string;
  /**
   * Employees deliberately left out, and why. Never empty silently — an
   * employee missing from a return is a filing defect, not a detail.
   */
  warnings: string[];
}

/** Statuses whose payslips are settled enough to file from. */
const FILEABLE_STATUSES: PayrollRunStatus[] = [
  PayrollRunStatus.COMPUTED,
  PayrollRunStatus.APPROVED,
  PayrollRunStatus.PAID,
];

/** The EPFO ECR field separator. Not a comma, and not configurable. */
const ECR_DELIMITER = '#~#';

const ZERO = new Decimal(0);

/**
 * The income tax quarter a calendar month falls in. Quarters run from April,
 * so January to March is Q4 of the financial year that opened the previous
 * April, not Q1 of the calendar year.
 */
export function quarterOf(month: number): number {
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4;
}

/** "Q1-2026-27" for Q1 of FY 2026-27, which is how TRACES labels a return. */
export function quarterLabel(quarter: number, financialYear: number): string {
  const nextYear = String((financialYear + 1) % 100).padStart(2, '0');
  return `Q${quarter}-${financialYear}-${nextYear}`;
}

/**
 * The three calendar months of a quarter, with the calendar year each belongs
 * to. Q4 spills into the next calendar year, which is what makes this worth a
 * function rather than arithmetic at each call site.
 */
export function monthsOfQuarter(
  quarter: number,
  financialYear: number,
): { month: number; year: number }[] {
  const firstMonth = quarter * 3 + 1; // Q1 -> 4, Q2 -> 7, Q3 -> 10, Q4 -> 13
  return [0, 1, 2].map((offset) => {
    const raw = firstMonth + offset;
    return raw > 12
      ? { month: raw - 12, year: financialYear + 1 }
      : { month: raw, year: financialYear };
  });
}

/**
 * Quotes a CSV field only when it needs it. Employee names carry commas often
 * enough ("Bo, Jr") that an unquoted writer silently shifts every later column.
 */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvRow(fields: (string | number)[]): string {
  return fields.map((f) => csvField(String(f))).join(',');
}

/** Whole rupees, as the ECR requires; it rejects paise. */
function rupees(value: Decimal): string {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0);
}

function money(value: Decimal): string {
  return value.toFixed(2);
}

/** Two digit month and four digit year, the stem of every filename here. */
function periodStamp(month: number, year: number): string {
  return `${String(month).padStart(2, '0')}${year}`;
}

/** The shape this service needs off a payslip; Prisma gives more. */
type PayslipWithEmployee = {
  workingDays: number;
  lopDays: number;
  grossPay: Decimal;
  netPay: Decimal;
  pfWages: Decimal;
  pfEmployee: Decimal;
  pfEmployer: Decimal;
  epsEmployer: Decimal;
  edliEmployer: Decimal;
  esiWages: Decimal;
  esiEmployee: Decimal;
  esiEmployer: Decimal;
  professionalTax: Decimal;
  tds: Decimal;
  employee: {
    employeeCode: string;
    firstName: string;
    lastName: string;
    uan: string | null;
    esiNumber: string | null;
    pan: string | null;
    bankAccountNumber: string | null;
    bankIfsc: string | null;
    currentState: string | null;
    branch: { state: string | null } | null;
  };
};

function fullName(employee: PayslipWithEmployee['employee']): string {
  return `${employee.firstName} ${employee.lastName}`.trim();
}

/** "E001 (Asha Rao)" — enough for payroll to find the record and fix it. */
function identify(employee: PayslipWithEmployee['employee']): string {
  return `${employee.employeeCode} (${fullName(employee)})`;
}

@Injectable()
export class ReturnsService {
  constructor(private prisma: PrismaService) {}

  /**
   * PF Electronic Challan cum Return, in the EPFO's `#~#` delimited text
   * format: one line per member, no header, no trailer.
   *
   * Fields, in order: UAN, member name, gross wages, EPF wages, EPS wages,
   * EDLI wages, EPF contribution due, EPS contribution due, EPF-EPS difference
   * due, NCP days, refund of advances.
   *
   * UNCERTAIN, verify against the current ECR template before uploading: the
   * EPFO has published more than one ECR revision and the field count has
   * changed between them, so both the column order above and whether your
   * establishment's portal expects a trailer line need checking. Amounts are
   * written as whole rupees because the ECR validator rejects paise.
   *
   * Derived rather than stored, and worth knowing: EPS and EDLI wages are not
   * columns on the payslip, so they are taken as the PF wage capped at the
   * configured statutory ceiling, and reported as zero where no such
   * contribution was actually made. Refund of advances is always zero — this
   * system does not track EPF advances at all.
   *
   * The establishment-level minimum on administration charges is not applied
   * here; it is a property of the establishment, not of any one member, so it
   * belongs on the challan rather than in these lines.
   */
  async pfEcr(tenantId: string, payrollRunId: string): Promise<GeneratedReturnFile> {
    const run = await this.loadFileableRun(tenantId, payrollRunId);
    const payslips = await this.loadPayslips(tenantId, payrollRunId);
    const config = await this.prisma.statutoryConfig.findUnique({ where: { tenantId } });

    const warnings: string[] = [];
    const ceiling = config ? new Decimal(config.pfWageCeiling) : null;

    if (!ceiling) {
      warnings.push(
        'No statutory configuration for this tenant; EPS and EDLI wages are reported uncapped.',
      );
    }

    const lines: string[] = [];

    for (const slip of payslips) {
      const pfWages = new Decimal(slip.pfWages);

      // Nothing contributed means nothing to declare for this member.
      if (pfWages.lte(0) && new Decimal(slip.pfEmployee).lte(0)) continue;

      if (!slip.employee.uan) {
        warnings.push(`${identify(slip.employee)}: skipped from the PF ECR, no UAN on record`);
        continue;
      }

      const cappedWages = ceiling ? Decimal.min(pfWages, ceiling) : pfWages;
      const epsWages = new Decimal(slip.epsEmployer).gt(0) ? cappedWages : ZERO;
      const edliWages = new Decimal(slip.edliEmployer).gt(0) ? cappedWages : ZERO;

      lines.push(
        [
          slip.employee.uan,
          // A literal delimiter inside a name would split the line in two.
          fullName(slip.employee).split(ECR_DELIMITER).join(' '),
          rupees(new Decimal(slip.grossPay)),
          rupees(pfWages),
          rupees(epsWages),
          rupees(edliWages),
          rupees(new Decimal(slip.pfEmployee)),
          rupees(new Decimal(slip.epsEmployer)),
          rupees(new Decimal(slip.pfEmployer)),
          String(slip.lopDays),
          '0',
        ].join(ECR_DELIMITER),
      );
    }

    return {
      filename: `pf-ecr-${periodStamp(run.month, run.year)}.txt`,
      contentType: 'text/plain',
      content: lines.join('\n'),
      warnings,
    };
  }

  /**
   * Monthly ESI contribution detail, as CSV.
   *
   * UNCERTAIN, check against the ESIC portal's own template: the columns here
   * are the ones asked for by this system's consumers — IP number, name, days,
   * wages, employee share, employer share. The ESIC monthly contribution
   * upload has historically asked for a narrower set (IP number, name, number
   * of days for which wages were paid, total monthly wages, a reason code when
   * days are zero, and last working day) and computed the contributions
   * itself. If you are uploading straight to the portal rather than
   * reconciling, the column list will need adjusting.
   *
   * "No of Days" is taken as working days less loss of pay, which is the
   * closest thing on the payslip to days for which wages were paid.
   *
   * Only employees the payroll actually treated as covered appear: an employee
   * above the wage limit is not silently listed with nil contributions.
   */
  async esiReturn(tenantId: string, payrollRunId: string): Promise<GeneratedReturnFile> {
    const run = await this.loadFileableRun(tenantId, payrollRunId);
    const payslips = await this.loadPayslips(tenantId, payrollRunId);

    const warnings: string[] = [];
    const rows: string[] = [
      csvRow([
        'IP Number',
        'IP Name',
        'No of Days',
        'Total Monthly Wages',
        'Employee Contribution',
        'Employer Contribution',
      ]),
    ];

    for (const slip of payslips) {
      const esiWages = new Decimal(slip.esiWages);
      if (esiWages.lte(0)) continue;

      if (!slip.employee.esiNumber) {
        warnings.push(
          `${identify(slip.employee)}: skipped from the ESI return, no ESI number on record`,
        );
        continue;
      }

      rows.push(
        csvRow([
          slip.employee.esiNumber,
          fullName(slip.employee),
          Math.max(slip.workingDays - slip.lopDays, 0),
          money(esiWages),
          money(new Decimal(slip.esiEmployee)),
          money(new Decimal(slip.esiEmployer)),
        ]),
      );
    }

    return {
      filename: `esi-return-${periodStamp(run.month, run.year)}.csv`,
      contentType: 'text/csv',
      content: rows.join('\n'),
      warnings,
    };
  }

  /**
   * Professional tax challan summary: one row per state, with the head count
   * and the total deducted.
   *
   * Professional tax is remitted state by state to a state authority, so the
   * state an employee is attributed to decides which challan their deduction
   * belongs on. It is taken from the employee's branch first, since that is
   * where they actually work, then their own recorded state, then the tenant's
   * configured PT state. An employee with none of the three is counted under
   * UNKNOWN and named in the warnings rather than dropped, because dropping
   * them would make the totals disagree with the payroll.
   *
   * This is a summary for preparing a challan, not a challan: the challan
   * itself needs the enrolment or registration number for each state, which
   * this system does not hold.
   */
  async professionalTaxChallan(
    tenantId: string,
    payrollRunId: string,
  ): Promise<GeneratedReturnFile> {
    const run = await this.loadFileableRun(tenantId, payrollRunId);
    const payslips = await this.loadPayslips(tenantId, payrollRunId);
    const config = await this.prisma.statutoryConfig.findUnique({ where: { tenantId } });

    const warnings: string[] = [];
    const totals = new Map<string, { count: number; amount: Decimal }>();

    for (const slip of payslips) {
      const professionalTax = new Decimal(slip.professionalTax);
      if (professionalTax.lte(0)) continue;

      const state =
        slip.employee.branch?.state ?? slip.employee.currentState ?? config?.ptState ?? null;

      if (!state) {
        warnings.push(
          `${identify(slip.employee)}: no branch, employee or configured state; counted under UNKNOWN`,
        );
      }

      const key = state ?? 'UNKNOWN';
      const running = totals.get(key) ?? { count: 0, amount: ZERO };
      totals.set(key, {
        count: running.count + 1,
        amount: running.amount.add(professionalTax),
      });
    }

    const rows: string[] = [csvRow(['State', 'Employee Count', 'Total Professional Tax'])];

    for (const [state, total] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push(csvRow([state, total.count, money(total.amount)]));
    }

    return {
      filename: `pt-challan-${periodStamp(run.month, run.year)}.csv`,
      contentType: 'text/csv',
      content: rows.join('\n'),
      warnings,
    };
  }

  /**
   * Form 24Q annexure data as CSV: PAN, name, gross salary paid and tax
   * deducted for the quarter, against section code 92B.
   *
   * This is the data behind the annexure, not a return you can file. Form 24Q
   * is filed as an FVU file produced by the NSDL Return Preparation Utility
   * from a fixed-width text file, and it needs a great deal this system does
   * not hold — challan identification numbers, BSR codes and deposit dates for
   * every remittance, deductor and responsible-person particulars, and for the
   * fourth quarter the whole of Annexure II. Take these figures into the RPU;
   * do not expect to upload this file anywhere.
   *
   * The quarter is the one the given run falls in, and every fileable run in
   * that quarter is added up, because a quarterly return covers the quarter
   * rather than the month. Section code 92B is hardcoded: it is salary paid to
   * a resident employee, which is what this payroll produces. Government
   * salary (92A) and salary to a non-resident (92C) are not distinguished
   * anywhere in the data, so anyone in those categories will be mislabelled.
   *
   * An employee whose tax for the quarter came to nil is still listed. A nil
   * deductee belongs in the return; omitting them breaks the reconciliation
   * against salary paid.
   */
  async form24Q(tenantId: string, payrollRunId: string): Promise<GeneratedReturnFile> {
    const run = await this.loadFileableRun(tenantId, payrollRunId);

    const quarter = quarterOf(run.month);
    const financialYear = run.month >= 4 ? run.year : run.year - 1;
    const months = monthsOfQuarter(quarter, financialYear);

    const runs = await this.prisma.payrollRun.findMany({
      where: {
        tenantId,
        status: { in: FILEABLE_STATUSES },
        OR: months.map((m) => ({ month: m.month, year: m.year })),
      },
      select: { id: true },
    });

    const payslips = (await this.prisma.payslip.findMany({
      where: { tenantId, payrollRunId: { in: runs.map((r) => r.id) } },
      include: { employee: { include: { branch: true } } },
      orderBy: { employee: { employeeCode: 'asc' } },
    })) as unknown as PayslipWithEmployee[];

    const warnings: string[] = [];
    const seenWithoutPan = new Set<string>();

    // Keyed by PAN rather than employee id: the return is filed per deductee,
    // and the deductee is the PAN.
    const byPan = new Map<string, { name: string; gross: Decimal; tds: Decimal }>();

    for (const slip of payslips) {
      if (!slip.employee.pan) {
        if (!seenWithoutPan.has(slip.employee.employeeCode)) {
          seenWithoutPan.add(slip.employee.employeeCode);
          warnings.push(
            `${identify(slip.employee)}: skipped from Form 24Q, no PAN on record`,
          );
        }
        continue;
      }

      const running = byPan.get(slip.employee.pan) ?? {
        name: fullName(slip.employee),
        gross: ZERO,
        tds: ZERO,
      };

      byPan.set(slip.employee.pan, {
        name: running.name,
        gross: running.gross.add(new Decimal(slip.grossPay)),
        tds: running.tds.add(new Decimal(slip.tds)),
      });
    }

    const rows: string[] = [
      csvRow(['PAN', 'Employee Name', 'Gross Salary Paid', 'Tax Deducted', 'Section Code']),
    ];

    for (const [pan, totals] of byPan.entries()) {
      rows.push(csvRow([pan, totals.name, money(totals.gross), money(totals.tds), '92B']));
    }

    return {
      filename: `form24q-annexure-${quarterLabel(quarter, financialYear)}.csv`,
      contentType: 'text/csv',
      content: rows.join('\n'),
      warnings,
    };
  }

  /**
   * NEFT-style bank transfer file: beneficiary name, account number, IFSC,
   * amount and a reference, one row per employee.
   *
   * UNCERTAIN by nature, and this one is worth saying plainly: there is no
   * single bank upload format. Every bank publishes its own column list, order
   * and header conventions for bulk salary uploads, and several want a debit
   * account row or a value date the payroll does not know. This is a generic
   * layout to be mapped onto whatever your bank asks for, not something to
   * upload unchanged.
   *
   * Employees with no account number or no IFSC are left out and named — a
   * transfer instruction missing either would be rejected by the bank anyway,
   * and a half-populated row is worse than an absent one. A net pay of zero or
   * less is also skipped: instructing a nil transfer achieves nothing and some
   * banks reject the whole file for it.
   */
  async bankTransferFile(
    tenantId: string,
    payrollRunId: string,
  ): Promise<GeneratedReturnFile> {
    const run = await this.loadFileableRun(tenantId, payrollRunId);
    const payslips = await this.loadPayslips(tenantId, payrollRunId);
    const stamp = periodStamp(run.month, run.year);

    const warnings: string[] = [];
    const rows: string[] = [
      csvRow(['Beneficiary Name', 'Account Number', 'IFSC', 'Amount', 'Reference']),
    ];

    for (const slip of payslips) {
      const missing: string[] = [];
      if (!slip.employee.bankAccountNumber) missing.push('no bank account number');
      if (!slip.employee.bankIfsc) missing.push('no IFSC');

      if (missing.length > 0) {
        warnings.push(
          `${identify(slip.employee)}: skipped from the bank transfer file, ${missing.join(', ')}`,
        );
        continue;
      }

      const netPay = new Decimal(slip.netPay);
      if (netPay.lte(0)) {
        warnings.push(
          `${identify(slip.employee)}: skipped from the bank transfer file, net pay is not positive`,
        );
        continue;
      }

      rows.push(
        csvRow([
          fullName(slip.employee),
          slip.employee.bankAccountNumber as string,
          slip.employee.bankIfsc as string,
          money(netPay),
          `SAL-${stamp}-${slip.employee.employeeCode}`,
        ]),
      );
    }

    return {
      filename: `bank-transfer-${stamp}.csv`,
      contentType: 'text/csv',
      content: rows.join('\n'),
      warnings,
    };
  }

  /**
   * Loads the run and refuses to file from one that has not been computed.
   * A DRAFT run has no payslips at all, so a return generated from it would be
   * an empty file that looks like a complete one.
   */
  private async loadFileableRun(tenantId: string, payrollRunId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: payrollRunId, tenantId },
      select: { id: true, month: true, year: true, status: true },
    });

    if (!run) {
      throw new NotFoundException('Payroll run not found');
    }

    if (!FILEABLE_STATUSES.includes(run.status)) {
      throw new BadRequestException(
        `Cannot generate a return from a ${run.status} payroll run; compute it first`,
      );
    }

    return run;
  }

  private async loadPayslips(
    tenantId: string,
    payrollRunId: string,
  ): Promise<PayslipWithEmployee[]> {
    return (await this.prisma.payslip.findMany({
      where: { tenantId, payrollRunId },
      include: { employee: { include: { branch: true } } },
      orderBy: { employee: { employeeCode: 'asc' } },
    })) as unknown as PayslipWithEmployee[];
  }
}
