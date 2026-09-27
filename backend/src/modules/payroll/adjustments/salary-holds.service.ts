import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  PayrollRunStatus,
  PayrollRunType,
  Prisma,
  SalaryHoldStatus,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { isPrismaError } from '../../../common/utils/prisma-errors';
import { NotificationsService } from '../../notifications/notifications.service';
import { SalaryHoldView } from '../payroll-depth.types';
import {
  EMPLOYEE_REF_SELECT,
  RUN_REF_SELECT,
  compareMonth,
  iso,
  runLabel,
  toEmployeeRef,
  toRunRef,
} from './views';

const VIEW_INCLUDE = {
  employee: { select: EMPLOYEE_REF_SELECT },
  payrollRun: { select: { ...RUN_REF_SELECT, scopeEmployeeIds: true } },
  releaseRun: { select: RUN_REF_SELECT },
} as const;

type HoldRow = Prisma.SalaryHoldGetPayload<{ include: typeof VIEW_INCLUDE }>;

function toView(row: HoldRow): SalaryHoldView {
  return {
    id: row.id,
    employee: toEmployeeRef(row.employee),
    payrollRun: toRunRef(row.payrollRun),
    reason: row.reason,
    status: row.status,
    heldAmount: row.heldAmount === null || row.heldAmount === undefined ? null : Number(row.heldAmount),
    releaseRun: row.releaseRun ? toRunRef(row.releaseRun) : null,
    releasedAt: iso(row.releasedAt),
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
    createdAt: iso(row.createdAt) as string,
  };
}

function cleanReason(reason: string | undefined): string {
  const value = (reason ?? '').trim();
  if (value.length < 1 || value.length > 500) {
    throw new BadRequestException('A reason of 1 to 500 characters is required');
  }
  return value;
}

/**
 * WS-C1 (Keka wave C, spec C3): hold an employee's net pay in a run, release it
 * later as a non-taxable line in another run, or void it.
 *
 * The held payslip is computed as usual (tax and PF accrue in the month
 * earned); only its net is withheld — left out of the bank transfer file and
 * credited to HELD_SALARY in the journal. Void is allowed only once the held
 * run is APPROVED or PAID, so the amount frozen on the hold is the filed net.
 */
@Injectable()
export class SalaryHoldsService {
  private readonly logger = new Logger(SalaryHoldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForRun(tenantId: string, runId: string): Promise<SalaryHoldView[]> {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, tenantId },
      select: { id: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    const rows = await this.prisma.salaryHold.findMany({
      where: { tenantId, payrollRunId: runId },
      include: VIEW_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return (rows ?? []).map(toView);
  }

  async list(tenantId: string, status?: SalaryHoldStatus): Promise<SalaryHoldView[]> {
    const rows = await this.prisma.salaryHold.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      include: VIEW_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    return (rows ?? []).map(toView);
  }

  async hold(
    actor: AuthenticatedUser,
    runId: string,
    input: { employeeId: string; reason: string },
  ): Promise<SalaryHoldView> {
    const tenantId = actor.tenantId;
    const reason = cleanReason(input.reason);

    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, tenantId },
      select: { ...RUN_REF_SELECT, scopeEmployeeIds: true },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    // Review I1: not once the run is APPROVED. The bank transfer file can be
    // downloaded from an approved run, and a salary held after that is in the
    // file already — then paid a second time when the hold is released.
    const holdable: PayrollRunStatus[] = [PayrollRunStatus.DRAFT, PayrollRunStatus.COMPUTED];
    if (!holdable.includes(run.status)) {
      throw new BadRequestException(
        run.status === PayrollRunStatus.PAID
          ? 'This run has been paid; its salaries can no longer be held'
          : `Salaries can be held in a DRAFT or COMPUTED run; this run is ${run.status}, and its bank transfer file may already include the salary`,
      );
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: input.employeeId, tenantId },
      select: { id: true, status: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    if (run.status === PayrollRunStatus.DRAFT) {
      if (run.runType === PayrollRunType.OFF_CYCLE) {
        if (!run.scopeEmployeeIds.includes(employee.id)) {
          throw new BadRequestException('The employee is not in the scope of this off-cycle run');
        }
      } else if (employee.status !== 'ACTIVE') {
        throw new BadRequestException('Only an active employee is paid by a regular run');
      }
    } else {
      const slip = await this.prisma.payslip.findFirst({
        where: { tenantId, payrollRunId: runId, employeeId: employee.id },
        select: { id: true },
      });
      if (!slip) {
        throw new BadRequestException('The employee has no payslip in this run, so there is nothing to hold');
      }
    }

    let row: HoldRow;
    try {
      row = await this.prisma.salaryHold.create({
        data: {
          tenantId,
          employeeId: employee.id,
          payrollRunId: runId,
          reason,
          status: SalaryHoldStatus.HELD,
          createdById: actor.userId,
        },
        include: VIEW_INCLUDE,
      });
    } catch (err) {
      if (isPrismaError(err, 'P2002')) {
        throw new ConflictException("The employee's salary is already held in this run");
      }
      throw err;
    }

    this.notify(
      tenantId,
      employee.id,
      NotificationType.SALARY_HELD,
      'Salary on hold',
      `Your salary for ${runLabel(run)} has been put on hold. Please contact HR for details.`,
    );
    return toView(row);
  }

  /** HELD and the run not PAID. */
  async unhold(tenantId: string, id: string): Promise<void> {
    const hold = await this.findHold(tenantId, id);
    if (hold.status !== SalaryHoldStatus.HELD) {
      throw new BadRequestException(`Only a HELD salary can be un-held; this one is ${hold.status}`);
    }
    if (hold.payrollRun.status === PayrollRunStatus.PAID) {
      throw new BadRequestException('The run has been paid; release or void the hold instead');
    }
    const res = await this.prisma.salaryHold.deleteMany({
      where: { id, tenantId, status: SalaryHoldStatus.HELD },
    });
    if (!res || res.count !== 1) {
      throw new ConflictException('The hold changed meanwhile; reload and try again');
    }
  }

  async release(actor: AuthenticatedUser, id: string, targetRunId: string): Promise<SalaryHoldView> {
    const tenantId = actor.tenantId;
    const hold = await this.findHold(tenantId, id);
    if (hold.status !== SalaryHoldStatus.HELD) {
      throw new BadRequestException(`Only a HELD salary can be released; this one is ${hold.status}`);
    }
    const heldRun = hold.payrollRun;
    if (heldRun.status !== PayrollRunStatus.APPROVED && heldRun.status !== PayrollRunStatus.PAID) {
      throw new BadRequestException(
        'A held salary can be released once its run is approved; until then, un-hold it instead',
      );
    }

    const target = await this.prisma.payrollRun.findFirst({
      where: { id: targetRunId, tenantId },
      select: { ...RUN_REF_SELECT, scopeEmployeeIds: true },
    });
    if (!target) throw new NotFoundException('Target payroll run not found');
    if (target.id === heldRun.id) {
      throw new BadRequestException('A held salary is released into a different run');
    }
    if (target.status !== PayrollRunStatus.DRAFT && target.status !== PayrollRunStatus.COMPUTED) {
      throw new BadRequestException(
        `A held salary can be released into a DRAFT or COMPUTED run; that run is ${target.status}`,
      );
    }
    if (compareMonth(target, heldRun) < 0) {
      throw new BadRequestException('The target run is for a month earlier than the held run');
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: hold.employeeId, tenantId },
      select: { id: true, status: true },
    });
    if (!employee) throw new NotFoundException('Employee not found');
    if (target.runType === PayrollRunType.OFF_CYCLE) {
      if (!target.scopeEmployeeIds.includes(employee.id)) {
        throw new BadRequestException('The employee is not in the scope of the target off-cycle run');
      }
    } else if (employee.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Only an active employee is paid by a regular run; release into an off-cycle run instead',
      );
    }

    const heldAmount = await this.heldNet(tenantId, hold.payrollRunId, hold.employeeId);
    if (heldAmount.lte(0)) {
      throw new BadRequestException('The held payslip has no net pay to release');
    }

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.salaryHold.updateMany({
        where: { id, tenantId, status: SalaryHoldStatus.HELD },
        data: {
          status: SalaryHoldStatus.RELEASED,
          heldAmount,
          releaseRunId: target.id,
          releasedAt: new Date(),
          releasedById: actor.userId,
        },
      });
      if (!res || res.count !== 1) {
        throw new ConflictException('The hold changed meanwhile; reload and try again');
      }
      // Guarded on the target's status: a COMPUTED target must be recomputed
      // to pay it; a DRAFT one pays it when processed.
      const guard = await tx.payrollRun.updateMany({
        where: { id: target.id, tenantId, status: target.status },
        data: { needsRecompute: target.status === PayrollRunStatus.COMPUTED },
      });
      if (!guard || guard.count !== 1) {
        throw new ConflictException('The target run changed meanwhile; reload and try again');
      }
    });

    this.notify(
      tenantId,
      hold.employeeId,
      NotificationType.SALARY_RELEASED,
      'Held salary released',
      `Your held salary for ${runLabel(heldRun)} has been released and will be paid with ${runLabel(target)}.`,
    );
    return toView(await this.findHold(tenantId, id));
  }

  async void(actor: AuthenticatedUser, id: string, reason: string): Promise<SalaryHoldView> {
    const tenantId = actor.tenantId;
    const voidReason = cleanReason(reason);
    const hold = await this.findHold(tenantId, id);
    if (hold.status !== SalaryHoldStatus.HELD) {
      throw new BadRequestException(`Only a HELD salary can be voided; this one is ${hold.status}`);
    }
    if (
      hold.payrollRun.status !== PayrollRunStatus.APPROVED &&
      hold.payrollRun.status !== PayrollRunStatus.PAID
    ) {
      throw new BadRequestException(
        'A hold can be voided once its run is approved; until then, un-hold it instead',
      );
    }
    const heldAmount = await this.heldNet(tenantId, hold.payrollRunId, hold.employeeId);

    const res = await this.prisma.salaryHold.updateMany({
      where: { id, tenantId, status: SalaryHoldStatus.HELD },
      data: {
        status: SalaryHoldStatus.VOIDED,
        heldAmount,
        voidedAt: new Date(),
        voidedById: actor.userId,
        voidReason,
      },
    });
    if (!res || res.count !== 1) {
      throw new ConflictException('The hold changed meanwhile; reload and try again');
    }
    return toView(await this.findHold(tenantId, id));
  }

  // --------------------------------------------------------------------------
  // Run helpers (called by PayrollService)
  // --------------------------------------------------------------------------

  /** Holds released into a run: each is a HOLD_RELEASE line on its payslip. */
  async releasesForRun(tenantId: string, runId: string) {
    return (
      (await this.prisma.salaryHold.findMany({
        where: { tenantId, releaseRunId: runId, status: SalaryHoldStatus.RELEASED },
        select: {
          id: true,
          employeeId: true,
          heldAmount: true,
          payrollRun: { select: { month: true, year: true } },
        },
      })) ?? []
    );
  }

  /** The target run is reset or deleted: its releases go back to HELD. */
  detachReleases(tx: Prisma.TransactionClient, tenantId: string, runId: string) {
    return tx.salaryHold.updateMany({
      where: { tenantId, releaseRunId: runId, status: SalaryHoldStatus.RELEASED },
      data: {
        status: SalaryHoldStatus.HELD,
        releaseRunId: null,
        releasedAt: null,
        releasedById: null,
        heldAmount: null,
      },
    });
  }

  private async findHold(tenantId: string, id: string): Promise<HoldRow> {
    const hold = await this.prisma.salaryHold.findFirst({
      where: { id, tenantId },
      include: VIEW_INCLUDE,
    });
    if (!hold) throw new NotFoundException('Salary hold not found');
    return hold;
  }

  private async heldNet(tenantId: string, runId: string, employeeId: string): Promise<Decimal> {
    const slip = await this.prisma.payslip.findFirst({
      where: { tenantId, payrollRunId: runId, employeeId },
      select: { id: true, netPay: true },
    });
    if (!slip) throw new BadRequestException('The held run has no payslip for this employee');
    return new Decimal(slip.netPay);
  }

  /** Fire-and-forget; the message never states amounts. */
  private notify(
    tenantId: string,
    employeeId: string,
    type: NotificationType,
    title: string,
    message: string,
  ) {
    Promise.resolve()
      .then(() => this.notifications.notifyEmployee(tenantId, employeeId, type, title, message, '/payroll'))
      .catch((err: unknown) =>
        this.logger.warn(`${type} notification failed: ${err instanceof Error ? err.message : err}`),
      );
  }
}
