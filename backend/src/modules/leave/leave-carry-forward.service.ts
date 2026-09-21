import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  isPrismaError,
  PRISMA_UNIQUE_VIOLATION,
} from '../../common/utils/prisma-errors';
import {
  AccrualTriggerType,
  CarryForwardRunStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';

export interface CarryForwardResult {
  runId: string;
  processedCount: number;
  failedCount: number;
  /** True when a run already existed for (tenantId, fromYear); nothing was written. */
  alreadyRan: boolean;
}

interface CarryForwardError {
  employeeId: string;
  message: string;
}

/**
 * Year-end leave carry-forward. For every active employee and every active
 * leave type with `carryForward = true`, the leftover balance of `fromYear`
 * is written into the `carriedOver` column of the `fromYear + 1` balance.
 *
 * Idempotency lives on `LeaveCarryForwardRun`, which is unique on
 * (tenantId, fromYear): a second call for the same year finds the run, writes
 * nothing and reports `alreadyRan: true`.
 */
@Injectable()
export class LeaveCarryForwardService {
  private readonly logger = new Logger(LeaveCarryForwardService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async runCarryForward(
    tenantId: string,
    fromYear: number,
    triggerType: AccrualTriggerType,
    triggeredById?: string,
  ): Promise<CarryForwardResult> {
    const toYear = fromYear + 1;

    const existing = await this.prisma.leaveCarryForwardRun.findUnique({
      where: { tenantId_fromYear: { tenantId, fromYear } },
    });

    if (existing) {
      return {
        runId: existing.id,
        processedCount: existing.processedCount,
        failedCount: existing.failedCount,
        alreadyRan: true,
      };
    }

    let run: { id: string };
    try {
      run = await this.prisma.leaveCarryForwardRun.create({
        data: {
          tenantId,
          fromYear,
          toYear,
          triggerType,
          triggeredById,
          status: CarryForwardRunStatus.PENDING,
        },
      });
    } catch (error) {
      // A concurrent trigger won the unique index; treat it as already run.
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        const winner = await this.prisma.leaveCarryForwardRun.findUnique({
          where: { tenantId_fromYear: { tenantId, fromYear } },
        });
        return {
          runId: winner?.id ?? '',
          processedCount: winner?.processedCount ?? 0,
          failedCount: winner?.failedCount ?? 0,
          alreadyRan: true,
        };
      }
      throw error;
    }

    try {
      const leaveTypes = await this.prisma.leaveType.findMany({
        where: { tenantId, isActive: true, carryForward: true },
      });

      const employees = await this.prisma.employee.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true },
      });

      let processedCount = 0;
      let failedCount = 0;
      const errors: CarryForwardError[] = [];

      for (const employee of employees) {
        try {
          const carried = await this.carryForwardEmployee(
            tenantId,
            employee.id,
            fromYear,
            toYear,
            leaveTypes,
          );
          processedCount++;

          if (carried.length > 0) {
            await this.notifyCarriedForward(
              tenantId,
              employee.id,
              toYear,
              carried,
            );
          }
        } catch (error) {
          failedCount++;
          const message = (error as Error).message;
          errors.push({ employeeId: employee.id, message });
          this.logger.error(
            `Carry-forward failed for employee ${employee.id}: ${message}`,
          );
        }
      }

      await this.prisma.leaveCarryForwardRun.update({
        where: { id: run.id },
        data: {
          status: CarryForwardRunStatus.COMPLETED,
          processedCount,
          failedCount,
          errorLog: errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : undefined,
          completedAt: new Date(),
        },
      });

      return { runId: run.id, processedCount, failedCount, alreadyRan: false };
    } catch (error) {
      await this.prisma.leaveCarryForwardRun.update({
        where: { id: run.id },
        data: {
          status: CarryForwardRunStatus.FAILED,
          errorLog: [
            { employeeId: '', message: (error as Error).message },
          ] as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      this.logger.error(
        `Carry-forward run ${run.id} failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Returns the leave types that actually carried a positive balance, so the
   * caller can decide whether the employee is worth notifying.
   */
  private async carryForwardEmployee(
    tenantId: string,
    employeeId: string,
    fromYear: number,
    toYear: number,
    leaveTypes: {
      id: string;
      name: string;
      defaultDays: number;
      maxCarryForward: number | null;
    }[],
  ): Promise<{ name: string; days: number }[]> {
    const carried: { name: string; days: number }[] = [];

    for (const leaveType of leaveTypes) {
      const fromBalance = await this.prisma.leaveBalance.findFirst({
        where: { tenantId, employeeId, leaveTypeId: leaveType.id, year: fromYear },
      });

      // Nothing accrued last year for this type, so nothing to carry.
      if (!fromBalance) continue;

      // pendingDays are deliberately NOT deducted: a pending request either
      // gets approved (and lands in usedDays) or rejected, and the year-end
      // snapshot should not pre-emptively burn the balance.
      const remaining =
        Number(fromBalance.totalDays) +
        Number(fromBalance.carriedOver) -
        Number(fromBalance.usedDays);

      let carry = Math.max(remaining, 0);
      if (leaveType.maxCarryForward !== null && leaveType.maxCarryForward !== undefined) {
        carry = Math.min(carry, Number(leaveType.maxCarryForward));
      }

      const toBalance = await this.prisma.leaveBalance.findFirst({
        where: { tenantId, employeeId, leaveTypeId: leaveType.id, year: toYear },
      });

      if (toBalance) {
        // The next year's row may already have been created by the accrual
        // job; only the carried column is ours to write.
        await this.prisma.leaveBalance.update({
          where: { id: toBalance.id },
          data: { carriedOver: carry },
        });
      } else {
        await this.prisma.leaveBalance.create({
          data: {
            tenantId,
            employeeId,
            leaveTypeId: leaveType.id,
            year: toYear,
            totalDays: leaveType.defaultDays,
            usedDays: 0,
            pendingDays: 0,
            carriedOver: carry,
          },
        });
      }

      if (carry > 0) {
        carried.push({ name: leaveType.name, days: carry });
      }
    }

    return carried;
  }

  private async notifyCarriedForward(
    tenantId: string,
    employeeId: string,
    toYear: number,
    carried: { name: string; days: number }[],
  ) {
    try {
      const lines = carried
        .map((c) => `${c.name}: ${c.days} day(s)`)
        .join('\n');
      await this.notificationsService.notifyEmployee(
        tenantId,
        employeeId,
        NotificationType.LEAVE_CARRIED_FORWARD,
        'Leave carried forward',
        `The following leave has been carried forward into ${toYear}:\n${lines}`,
        '/leave',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to notify employee ${employeeId} about carry-forward: ${(error as Error).message}`,
      );
    }
  }

  async getRuns(tenantId: string) {
    return this.prisma.leaveCarryForwardRun.findMany({
      where: { tenantId },
      orderBy: { fromYear: 'desc' },
    });
  }
}
