import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PayrollRunStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { classifyPayslipLine, PayslipLine } from '../payroll-lines.types';
import { lineCandidates } from './journal-builder';
import { csvRow } from './csv-journal';
import { AccountingExportFile } from './accounting-export.service';
import {
  GlKeyCategory,
  VarianceAmount,
  VarianceComponentDelta,
  VarianceComponentRow,
  VarianceEmployeeRow,
  VarianceEmployeeStatus,
  VarianceReport,
  VarianceRunRef,
} from './accounting.types';

export interface VarianceQuery {
  runId: string;
  /** Default: the previous month's REGULAR run. */
  compareRunId?: string;
  /** Default 10. */
  thresholdPct?: number;
}

const DEFAULT_THRESHOLD_PCT = 10;
const NOT_READABLE_STATUSES: PayrollRunStatus[] = [PayrollRunStatus.DRAFT, PayrollRunStatus.PROCESSING];

type PayslipWithEmployee = {
  employeeId: string;
  basePay: Decimal;
  otPay: Decimal;
  earnings: unknown;
  deductions: unknown;
  grossPay: Decimal;
  totalDeductions: Decimal;
  netPay: Decimal;
  pfEmployee: Decimal;
  esiEmployee: Decimal;
  professionalTax: Decimal;
  lwfEmployee: Decimal;
  tds: Decimal;
  employee: {
    employeeCode: string;
    firstName: string;
    lastName: string;
    department: { name: string } | null;
  };
};

interface ComponentAmount {
  amount: Decimal;
  category: GlKeyCategory;
}

/**
 * WS-C2 (Keka wave C, spec C8): this run against a previous one, per employee
 * and per component.
 */
@Injectable()
export class VarianceReportService {
  constructor(private readonly prisma: PrismaService) {}

  async build(tenantId: string, query: VarianceQuery): Promise<VarianceReport> {
    const thresholdPct = query.thresholdPct ?? DEFAULT_THRESHOLD_PCT;
    const run = await this.loadReadableRun(tenantId, query.runId);
    const compareRun = await this.resolveCompareRun(tenantId, run, query.compareRunId);

    const [currentPayslips, previousPayslips] = await Promise.all([
      this.loadPayslips(tenantId, run.id),
      compareRun ? this.loadPayslips(tenantId, compareRun.id) : Promise.resolve([]),
    ]);

    const currentByEmployee = new Map(currentPayslips.map((p) => [p.employeeId, p]));
    const previousByEmployee = new Map(previousPayslips.map((p) => [p.employeeId, p]));
    const employeeIds = new Set([...currentByEmployee.keys(), ...previousByEmployee.keys()]);

    const employees: VarianceEmployeeRow[] = [];
    const employeesAffectedByKey = new Map<string, Set<string>>();

    for (const employeeId of employeeIds) {
      const current = currentByEmployee.get(employeeId);
      const previous = previousByEmployee.get(employeeId);

      const status: VarianceEmployeeStatus = !previous ? 'NEW' : !current ? 'LEFT' : 'UNCHANGED';

      const gross = varianceAmount(current?.grossPay, previous?.grossPay);
      const deductions = varianceAmount(current?.totalDeductions, previous?.totalDeductions);
      const net = varianceAmount(current?.netPay, previous?.netPay);

      const currentComponents = current ? componentsOf(current) : new Map<string, ComponentAmount>();
      const previousComponents = previous ? componentsOf(previous) : new Map<string, ComponentAmount>();
      const componentKeys = new Set([...currentComponents.keys(), ...previousComponents.keys()]);

      const components: VarianceComponentDelta[] = [];
      for (const key of componentKeys) {
        const cur = currentComponents.get(key)?.amount ?? new Decimal(0);
        const prev = previousComponents.get(key)?.amount ?? new Decimal(0);
        const delta = cur.sub(prev);
        if (delta.isZero()) continue;
        components.push({
          key,
          category: currentComponents.get(key)?.category ?? previousComponents.get(key)!.category,
          current: cur.toNumber(),
          previous: prev.toNumber(),
          delta: delta.toNumber(),
        });
        const set = employeesAffectedByKey.get(key) ?? new Set<string>();
        set.add(employeeId);
        employeesAffectedByKey.set(key, set);
      }
      components.sort((a, b) => a.key.localeCompare(b.key));

      const resolvedStatus: VarianceEmployeeStatus =
        status !== 'UNCHANGED'
          ? status
          : gross.delta !== 0 || deductions.delta !== 0 || net.delta !== 0 || components.length > 0
            ? 'CHANGED'
            : 'UNCHANGED';

      const flagged =
        resolvedStatus === 'NEW' ||
        resolvedStatus === 'LEFT' ||
        [gross, deductions, net].some((a) => exceedsThreshold(a, thresholdPct));

      employees.push({
        employeeId,
        employeeCode: (current ?? previous)!.employee.employeeCode,
        name: `${(current ?? previous)!.employee.firstName} ${(current ?? previous)!.employee.lastName}`,
        department: (current ?? previous)!.employee.department?.name ?? null,
        status: resolvedStatus,
        gross,
        deductions,
        net,
        flagged,
        components,
      });
    }
    employees.sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));

    const totals = {
      gross: sumAmount(currentPayslips, previousPayslips, (p) => p.grossPay),
      deductions: sumAmount(currentPayslips, previousPayslips, (p) => p.totalDeductions),
      net: sumAmount(currentPayslips, previousPayslips, (p) => p.netPay),
      headcount: { current: currentPayslips.length, previous: previousPayslips.length },
    };

    const components = this.buildComponentRows(currentPayslips, previousPayslips, employeesAffectedByKey);

    return {
      run: runRef(run),
      compareRun: compareRun ? runRef(compareRun) : null,
      thresholdPct,
      totals,
      employees,
      components,
    };
  }

  async exportCsv(tenantId: string, query: VarianceQuery): Promise<AccountingExportFile> {
    const report = await this.build(tenantId, query);

    const rows: string[] = [
      csvRow([
        'Employee Code',
        'Name',
        'Department',
        'Status',
        'Gross Current',
        'Gross Previous',
        'Gross Delta',
        'Deductions Current',
        'Deductions Previous',
        'Deductions Delta',
        'Net Current',
        'Net Previous',
        'Net Delta',
        'Net Delta %',
        'Flagged',
      ]),
    ];

    for (const employee of report.employees) {
      rows.push(
        csvRow([
          employee.employeeCode,
          employee.name,
          employee.department ?? '',
          employee.status,
          employee.gross.current,
          employee.gross.previous,
          employee.gross.delta,
          employee.deductions.current,
          employee.deductions.previous,
          employee.deductions.delta,
          employee.net.current,
          employee.net.previous,
          employee.net.delta,
          employee.net.deltaPct ?? '',
          employee.flagged ? 'Yes' : 'No',
        ]),
      );
    }

    const stamp = `${report.run.year}-${String(report.run.month).padStart(2, '0')}`;
    return {
      filename: `variance-${stamp}.csv`,
      contentType: 'text/csv',
      content: rows.join('\r\n') + '\r\n',
    };
  }

  private buildComponentRows(
    currentPayslips: PayslipWithEmployee[],
    previousPayslips: PayslipWithEmployee[],
    employeesAffectedByKey: Map<string, Set<string>>,
  ): VarianceComponentRow[] {
    const totals = new Map<string, { current: Decimal; previous: Decimal; category: GlKeyCategory }>();

    const accumulate = (payslips: PayslipWithEmployee[], side: 'current' | 'previous') => {
      for (const payslip of payslips) {
        for (const [key, { amount, category }] of componentsOf(payslip)) {
          const entry = totals.get(key) ?? { current: new Decimal(0), previous: new Decimal(0), category };
          entry[side] = entry[side].add(amount);
          totals.set(key, entry);
        }
      }
    };
    accumulate(currentPayslips, 'current');
    accumulate(previousPayslips, 'previous');

    const rows: VarianceComponentRow[] = [];
    for (const [key, entry] of totals) {
      const delta = entry.current.sub(entry.previous);
      rows.push({
        key,
        category: entry.category,
        current: entry.current.toNumber(),
        previous: entry.previous.toNumber(),
        delta: delta.toNumber(),
        deltaPct: entry.previous.isZero() ? null : delta.div(entry.previous).mul(100).toDecimalPlaces(2).toNumber(),
        employeesAffected: employeesAffectedByKey.get(key)?.size ?? 0,
      });
    }
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return rows;
  }

  private async loadReadableRun(tenantId: string, runId: string) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (NOT_READABLE_STATUSES.includes(run.status)) {
      throw new BadRequestException(`Cannot report variance for a ${run.status} payroll run`);
    }
    return run;
  }

  private async resolveCompareRun(
    tenantId: string,
    run: { month: number; year: number },
    compareRunId?: string,
  ) {
    if (compareRunId) {
      return this.loadReadableRun(tenantId, compareRunId);
    }

    const prevMonth = run.month === 1 ? 12 : run.month - 1;
    const prevYear = run.month === 1 ? run.year - 1 : run.year;
    return this.prisma.payrollRun.findFirst({
      where: {
        tenantId,
        runType: 'REGULAR',
        month: prevMonth,
        year: prevYear,
        status: { notIn: NOT_READABLE_STATUSES },
      },
    });
  }

  private async loadPayslips(tenantId: string, payrollRunId: string): Promise<PayslipWithEmployee[]> {
    return (await this.prisma.payslip.findMany({
      where: { tenantId, payrollRunId },
      include: { employee: { include: { department: true } } },
    })) as unknown as PayslipWithEmployee[];
  }
}

function runRef(run: {
  id: string;
  month: number;
  year: number;
  runType: string;
  sequence: number;
  status: string;
}): VarianceRunRef {
  return {
    id: run.id,
    month: run.month,
    year: run.year,
    runType: run.runType as VarianceRunRef['runType'],
    sequence: run.sequence,
    status: run.status as VarianceRunRef['status'],
  };
}

function varianceAmount(current?: Decimal | number, previous?: Decimal | number): VarianceAmount {
  const cur = current === undefined ? new Decimal(0) : new Decimal(current);
  const prev = previous === undefined ? new Decimal(0) : new Decimal(previous);
  const delta = cur.sub(prev);
  return {
    current: cur.toNumber(),
    previous: prev.toNumber(),
    delta: delta.toNumber(),
    deltaPct: prev.isZero() ? null : delta.div(prev).mul(100).toDecimalPlaces(2).toNumber(),
  };
}

function exceedsThreshold(amount: VarianceAmount, thresholdPct: number): boolean {
  if (amount.deltaPct !== null) return Math.abs(amount.deltaPct) >= thresholdPct;
  return amount.delta !== 0;
}

function sumAmount(
  current: PayslipWithEmployee[],
  previous: PayslipWithEmployee[],
  select: (p: PayslipWithEmployee) => Decimal,
): VarianceAmount {
  const cur = current.reduce((sum, p) => sum.add(select(p)), new Decimal(0));
  const prev = previous.reduce((sum, p) => sum.add(select(p)), new Decimal(0));
  return varianceAmount(cur, prev);
}

/**
 * Every earning/deduction component for one payslip, keyed like the GL keys
 * (BASIC, OT_PAY, line names, statutory columns) — the same identity scheme
 * journal-builder uses, without any GL mapping resolution: variance compares
 * components as they are, not as they will be posted.
 */
function componentsOf(payslip: PayslipWithEmployee): Map<string, ComponentAmount> {
  const map = new Map<string, ComponentAmount>();
  const add = (key: string, category: GlKeyCategory, amount: Decimal) => {
    if (amount.isZero() && !map.has(key)) return;
    const entry = map.get(key);
    if (entry) entry.amount = entry.amount.add(amount);
    else map.set(key, { amount, category });
  };

  add('BASIC', 'EARNING', new Decimal(payslip.basePay));
  add('OT_PAY', 'EARNING', new Decimal(payslip.otPay));

  for (const line of (payslip.earnings as unknown as PayslipLine[]) ?? []) {
    const kind = classifyPayslipLine(line, 'earning');
    const { candidates, category } = lineCandidates(kind, 'earning', line.name);
    add(candidates[0], category, new Decimal(line.amount));
  }
  for (const line of (payslip.deductions as unknown as PayslipLine[]) ?? []) {
    const kind = classifyPayslipLine(line, 'deduction');
    if (kind === 'STATUTORY') continue; // the columns below are the source
    const { candidates, category } = lineCandidates(kind, 'deduction', line.name);
    add(candidates[0], category, new Decimal(line.amount));
  }

  add('PF_EMPLOYEE', 'DEDUCTION', new Decimal(payslip.pfEmployee));
  add('ESI_EMPLOYEE', 'DEDUCTION', new Decimal(payslip.esiEmployee));
  add('PROFESSIONAL_TAX', 'DEDUCTION', new Decimal(payslip.professionalTax));
  add('LWF_EMPLOYEE', 'DEDUCTION', new Decimal(payslip.lwfEmployee));
  add('TDS', 'DEDUCTION', new Decimal(payslip.tds));

  return map;
}
