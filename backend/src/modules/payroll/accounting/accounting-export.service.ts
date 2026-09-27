import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, PayrollRunStatus, SalaryHoldStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { PayslipLine } from '../payroll-lines.types';
import { AccountingConfigService } from './accounting-config.service';
import { GlMappingService } from './gl-mapping.service';
import { buildJournal, JournalPayslipInput } from './journal-builder';
import { toCsvJournal } from './csv-journal';
import { toTallyXml } from './tally-xml';
import { AccountingExportFormat, JournalPreview } from './accounting.types';

export interface AccountingExportFile {
  filename: string;
  contentType: string;
  content: string;
}

const PREVIEWABLE_STATUSES: PayrollRunStatus[] = [
  PayrollRunStatus.COMPUTED,
  PayrollRunStatus.APPROVED,
  PayrollRunStatus.PAID,
];
const EXPORTABLE_STATUSES: PayrollRunStatus[] = [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Last day of `month` (1-12) in `year`, as YYYY-MM-DD. */
function lastDayOfMonth(month: number, year: number): string {
  const day = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function renderNarration(template: string, month: number, year: number): string {
  return template
    .replace(/\{\{\s*month\s*\}\}/g, MONTH_NAMES[month - 1] ?? String(month))
    .replace(/\{\{\s*year\s*\}\}/g, String(year));
}

/**
 * WS-C2 (Keka wave C, spec C7): journal voucher preview and CSV / Tally XML
 * export of a payroll run.
 */
@Injectable()
export class AccountingExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AccountingConfigService,
    private readonly mappings: GlMappingService,
  ) {}

  async preview(tenantId: string, runId: string, allowUnmapped: boolean): Promise<JournalPreview> {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (!PREVIEWABLE_STATUSES.includes(run.status)) {
      throw new BadRequestException(
        `Cannot build a journal from a ${run.status} payroll run; compute it first`,
      );
    }

    const [payslips, holds, config, mappingsResponse] = await Promise.all([
      this.prisma.payslip.findMany({
        where: { tenantId, payrollRunId: runId },
        include: { employee: { include: { department: true, branch: true } } },
      }),
      // Review I2: every hold the bank transfer file leaves out of this run.
      // HELD waits, VOIDED is never paid and RELEASED is paid by another run
      // (whose HOLD_RELEASE line clears HELD_SALARY), so none of their net is
      // paid by this run's transfer.
      this.prisma.salaryHold.findMany({
        where: {
          tenantId,
          payrollRunId: runId,
          status: { in: [SalaryHoldStatus.HELD, SalaryHoldStatus.VOIDED, SalaryHoldStatus.RELEASED] },
        },
        select: { employeeId: true },
      }),
      this.config.get(tenantId),
      this.mappings.getMappings(tenantId),
    ]);

    const heldEmployeeIds = new Set(holds.map((h) => h.employeeId));
    const mappingsByKey = new Map(
      mappingsResponse.mappings.map((m) => [m.componentKey, { glCode: m.glCode, glName: m.glName }]),
    );
    const suspense =
      config.suspenseGlCode && config.suspenseGlName
        ? { glCode: config.suspenseGlCode, glName: config.suspenseGlName }
        : null;

    const journalInputs: JournalPayslipInput[] = payslips.map((p) => ({
      employeeId: p.employeeId,
      departmentName: (p as unknown as { employee: { department?: { name: string } | null } }).employee
        .department?.name ?? null,
      branchName: (p as unknown as { employee: { branch?: { name: string } | null } }).employee.branch
        ?.name ?? null,
      basePay: p.basePay,
      otPay: p.otPay,
      earnings: (p.earnings as unknown as PayslipLine[]) ?? [],
      deductions: (p.deductions as unknown as PayslipLine[]) ?? [],
      netPay: p.netPay,
      pfEmployee: p.pfEmployee,
      esiEmployee: p.esiEmployee,
      professionalTax: p.professionalTax,
      lwfEmployee: p.lwfEmployee,
      tds: p.tds,
      pfEmployer: p.pfEmployer,
      epsEmployer: p.epsEmployer,
      edliEmployer: p.edliEmployer,
      pfAdminEmployer: p.pfAdminEmployer,
      esiEmployer: p.esiEmployer,
      lwfEmployer: p.lwfEmployer,
      held: heldEmployeeIds.has(p.employeeId),
    }));

    const built = buildJournal(journalInputs, {
      mappings: mappingsByKey,
      suspense,
      costCenterMode: config.costCenterMode,
      allowUnmapped,
    });

    if (!built.balanced) {
      const difference = built.totalDebit.sub(built.totalCredit).abs().toFixed(2);
      throw new BadRequestException(`Journal does not balance (difference ₹${difference})`);
    }

    return {
      runId: run.id,
      month: run.month,
      year: run.year,
      runType: run.runType,
      sequence: run.sequence,
      status: run.status,
      voucherDate: lastDayOfMonth(run.month, run.year),
      narration: renderNarration(config.narrationTemplate, run.month, run.year),
      lines: built.lines,
      totalDebit: built.totalDebit.toNumber(),
      totalCredit: built.totalCredit.toNumber(),
      balanced: built.balanced,
      unmappedKeys: built.unmappedKeys,
      exportable: EXPORTABLE_STATUSES.includes(run.status),
    };
  }

  /** APPROVED / PAID runs only; audit-logged. */
  async export(
    actor: AuthenticatedUser,
    runId: string,
    format: AccountingExportFormat,
    allowUnmapped: boolean,
  ): Promise<AccountingExportFile> {
    const preview = await this.preview(actor.tenantId, runId, allowUnmapped);

    if (!preview.exportable) {
      throw new BadRequestException(
        `Cannot export from a ${preview.status} payroll run; it must be approved or paid first`,
      );
    }
    if (preview.unmappedKeys.length > 0 && !allowUnmapped) {
      throw new BadRequestException(
        `Cannot export: the following keys have no GL mapping: ${preview.unmappedKeys.join(', ')}`,
      );
    }

    const stamp = `${preview.year}-${String(preview.month).padStart(2, '0')}`;
    const suffix = preview.runType === 'OFF_CYCLE' ? `-oc${preview.sequence}` : '';

    let file: AccountingExportFile;
    if (format === 'csv') {
      file = {
        filename: `journal-${stamp}${suffix}.csv`,
        contentType: 'text/csv',
        content: toCsvJournal(preview),
      };
    } else {
      const config = await this.config.get(actor.tenantId);
      file = {
        filename: `journal-${stamp}${suffix}.xml`,
        contentType: 'application/xml',
        content: toTallyXml(preview, config),
      };
    }

    await this.audit.log({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.CREATE,
      entityType: 'PayrollAccountingExport',
      entityId: runId,
      newValues: { format, allowUnmapped, totalDebit: preview.totalDebit },
    });

    return file;
  }
}
