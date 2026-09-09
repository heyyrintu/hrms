import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { isPrismaError, PRISMA_UNIQUE_VIOLATION } from '../../common/utils/prisma-errors';
import {
  CreateAccrualRuleDto,
  UpdateAccrualRuleDto,
  TriggerAccrualDto,
  AccrualRunQueryDto,
} from './dto/accrual.dto';
import {
  AccrualTriggerType,
  AccrualStatus,
  NotificationType,
  AuditAction,
} from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class LeaveAccrualService {
  private readonly logger = new Logger(LeaveAccrualService.name);
  private readonly FISCAL_YEAR_START_MONTH = 4; // April (1-indexed)

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private auditService: AuditService,
  ) {}

  // ==========================================
  // ACCRUAL RULE MANAGEMENT
  // ==========================================

  async createAccrualRule(tenantId: string, dto: CreateAccrualRuleDto) {
    // Check if rule already exists
    const existing = await this.prisma.leaveAccrualRule.findUnique({
      where: {
        tenantId_leaveTypeId: { tenantId, leaveTypeId: dto.leaveTypeId },
      },
    });

    if (existing) {
      throw new ConflictException(
        'Accrual rule already exists for this leave type',
      );
    }

    // Verify leave type exists
    const leaveType = await this.prisma.leaveType.findFirst({
      where: { id: dto.leaveTypeId, tenantId, isActive: true },
    });

    if (!leaveType) {
      throw new NotFoundException('Leave type not found');
    }

    return this.prisma.leaveAccrualRule.create({
      data: {
        tenantId,
        leaveTypeId: dto.leaveTypeId,
        monthlyAccrualDays: dto.monthlyAccrualDays,
        maxBalanceCap: dto.maxBalanceCap,
        applyCapOnAccrual: dto.applyCapOnAccrual ?? true,
      },
      include: { leaveType: true },
    });
  }

  async getAccrualRules(tenantId: string) {
    return this.prisma.leaveAccrualRule.findMany({
      where: { tenantId, isActive: true },
      include: { leaveType: true },
      orderBy: { leaveType: { name: 'asc' } },
    });
  }

  async getAccrualRuleById(tenantId: string, id: string) {
    const rule = await this.prisma.leaveAccrualRule.findFirst({
      where: { id, tenantId },
      include: { leaveType: true },
    });

    if (!rule) {
      throw new NotFoundException('Accrual rule not found');
    }

    return rule;
  }

  async updateAccrualRule(
    tenantId: string,
    id: string,
    dto: UpdateAccrualRuleDto,
  ) {
    const rule = await this.getAccrualRuleById(tenantId, id);

    // If changing leave type, check for conflicts
    if (dto.leaveTypeId !== rule.leaveTypeId) {
      const existing = await this.prisma.leaveAccrualRule.findUnique({
        where: {
          tenantId_leaveTypeId: { tenantId, leaveTypeId: dto.leaveTypeId },
        },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(
          'Accrual rule already exists for this leave type',
        );
      }
    }

    return this.prisma.leaveAccrualRule.update({
      where: { id },
      data: {
        leaveTypeId: dto.leaveTypeId,
        monthlyAccrualDays: dto.monthlyAccrualDays,
        maxBalanceCap: dto.maxBalanceCap,
        applyCapOnAccrual: dto.applyCapOnAccrual,
      },
      include: { leaveType: true },
    });
  }

  async deleteAccrualRule(tenantId: string, id: string) {
    await this.getAccrualRuleById(tenantId, id);

    return this.prisma.leaveAccrualRule.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ==========================================
  // ACCRUAL EXECUTION
  // ==========================================

  async triggerAccrual(
    tenantId: string,
    dto: TriggerAccrualDto,
    triggerType: AccrualTriggerType,
    triggeredBy?: string,
  ) {
    const { month, year, employeeIds, leaveTypeIds } = dto;

    // Validate month/year
    if (month < 1 || month > 12) {
      throw new BadRequestException('Invalid month (must be 1-12)');
    }

    const label = `${year}-${month.toString().padStart(2, '0')}`;

    // One run row exists per (tenant, month, year). Decide what to do with it:
    //   COMPLETED -> refuse (already credited)
    //   PENDING   -> refuse (another trigger is mid-flight)
    //   FAILED    -> resume it, skipping pairs it already credited
    //   none      -> create it (a concurrent create loses on the unique index)
    const existingRun = await this.prisma.leaveAccrualRun.findUnique({
      where: { tenantId_month_year: { tenantId, month, year } },
    });

    if (existingRun?.status === AccrualStatus.COMPLETED) {
      throw new ConflictException(`Accrual already completed for ${label}`);
    }
    if (existingRun?.status === AccrualStatus.PENDING) {
      throw new ConflictException(`Accrual for ${label} is already in progress`);
    }

    // Calculate fiscal year
    const fiscalYear = month >= this.FISCAL_YEAR_START_MONTH ? year : year - 1;

    let accrualRun: { id: string };
    // Pairs (employeeId:leaveTypeId) already credited by a previous failed
    // attempt of this same run; they must not be credited again.
    const alreadyCredited = new Set<string>();

    if (existingRun) {
      // Claim conditionally: two concurrent resumes would otherwise both flip the
      // run to PENDING and both enter the crediting loop, and the alreadyCredited
      // snapshot is taken before crediting starts so it would not exclude the
      // pairs the other run is writing. The loser sees count === 0.
      const claimed = await this.prisma.leaveAccrualRun.updateMany({
        where: { id: existingRun.id, status: AccrualStatus.FAILED },
        data: {
          status: AccrualStatus.PENDING,
          errorMessage: null,
          completedAt: null,
          triggerType,
          triggeredBy,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException(`Accrual for ${label} is already in progress`);
      }
      const priorEntries = await this.prisma.leaveAccrualEntry.findMany({
        where: { accrualRunId: existingRun.id },
        select: { employeeId: true, leaveTypeId: true },
      });
      for (const e of priorEntries) {
        alreadyCredited.add(`${e.employeeId}:${e.leaveTypeId}`);
      }
      accrualRun = { id: existingRun.id };
    } else {
      try {
        accrualRun = await this.prisma.leaveAccrualRun.create({
          data: {
            tenantId,
            month,
            year,
            fiscalYear,
            triggerType,
            triggeredBy,
            status: AccrualStatus.PENDING,
          },
        });
      } catch (err) {
        if (isPrismaError(err, PRISMA_UNIQUE_VIOLATION)) {
          throw new ConflictException(`Accrual for ${label} is already in progress`);
        }
        throw err;
      }
    }

    try {
      // Get eligible employees (ACTIVE only)
      const employeeWhere: any = { tenantId, status: 'ACTIVE' };
      if (employeeIds && employeeIds.length > 0) {
        employeeWhere.id = { in: employeeIds };
      }

      const employees = await this.prisma.employee.findMany({
        where: employeeWhere,
        select: { id: true, firstName: true, lastName: true },
      });

      // Get accrual rules
      const ruleWhere: any = { tenantId, isActive: true };
      if (leaveTypeIds && leaveTypeIds.length > 0) {
        ruleWhere.leaveTypeId = { in: leaveTypeIds };
      }

      const rules = await this.prisma.leaveAccrualRule.findMany({
        where: ruleWhere,
        include: { leaveType: true },
      });

      if (rules.length === 0) {
        throw new BadRequestException('No active accrual rules found');
      }

      let processedCount = 0;
      let failedCount = 0;
      const notificationBatch: { employeeId: string; accruals: string[] }[] =
        [];

      // Process each employee x leave type combination
      for (const employee of employees) {
        const employeeAccruals: string[] = [];

        for (const rule of rules) {
          if (alreadyCredited.has(`${employee.id}:${rule.leaveTypeId}`)) {
            continue;
          }
          try {
            // Get or create balance for this year
            let balance = await this.prisma.leaveBalance.findFirst({
              where: {
                tenantId,
                employeeId: employee.id,
                leaveTypeId: rule.leaveTypeId,
                year,
              },
            });

            if (!balance) {
              balance = await this.prisma.leaveBalance.create({
                data: {
                  tenantId,
                  employeeId: employee.id,
                  leaveTypeId: rule.leaveTypeId,
                  year,
                  totalDays: 0,
                  usedDays: 0,
                  pendingDays: 0,
                  carriedOver: 0,
                },
              });
            }

            const balanceBefore = balance.totalDays;
            let accrualDays = new Decimal(rule.monthlyAccrualDays);
            let capApplied = false;
            let capAmount: Decimal | null = null;

            // Apply max balance cap if configured
            if (rule.applyCapOnAccrual && rule.maxBalanceCap) {
              const projectedBalance =
                Number(balanceBefore) + Number(accrualDays);
              if (projectedBalance > Number(rule.maxBalanceCap)) {
                const excessDays =
                  projectedBalance - Number(rule.maxBalanceCap);
                accrualDays = new Decimal(
                  Math.max(0, Number(accrualDays) - excessDays),
                );
                capApplied = true;
                capAmount = new Decimal(rule.maxBalanceCap);
              }
            }

            // Skip if no days to accrue
            if (Number(accrualDays) === 0) {
              this.logger.log(
                `Skipping accrual for ${employee.firstName} ${employee.lastName} - ${rule.leaveType.name} (cap reached)`,
              );
              continue;
            }

            // Update balance in transaction
            const updatedBalance = await this.prisma.leaveBalance.update({
              where: { id: balance.id },
              data: {
                totalDays: { increment: accrualDays },
              },
            });

            // Create accrual entry
            await this.prisma.leaveAccrualEntry.create({
              data: {
                tenantId,
                accrualRunId: accrualRun.id,
                employeeId: employee.id,
                leaveTypeId: rule.leaveTypeId,
                leaveBalanceId: balance.id,
                accrualDays,
                balanceBefore,
                balanceAfter: updatedBalance.totalDays,
                capApplied,
                capAmount,
              },
            });

            employeeAccruals.push(
              `${rule.leaveType.name}: +${accrualDays} days${capApplied ? ' (cap applied)' : ''}`,
            );
            processedCount++;
          } catch (error) {
            this.logger.error(
              `Failed to process accrual for employee ${employee.id}, leave type ${rule.leaveTypeId}: ${(error as Error).message}`,
            );
            failedCount++;
          }
        }

        if (employeeAccruals.length > 0) {
          notificationBatch.push({
            employeeId: employee.id,
            accruals: employeeAccruals,
          });
        }
      }

      // Update accrual run status
      await this.prisma.leaveAccrualRun.update({
        where: { id: accrualRun.id },
        data: {
          status: AccrualStatus.COMPLETED,
          processedCount,
          failedCount,
          completedAt: new Date(),
        },
      });

      // Send batch notifications
      await this.sendAccrualNotifications(tenantId, notificationBatch);

      // Audit log
      await this.auditService.log({
        tenantId,
        userId: triggeredBy,
        action: AuditAction.CREATE,
        entityType: 'LeaveAccrualRun',
        entityId: accrualRun.id,
        newValues: {
          month,
          year,
          processedCount,
          failedCount,
          triggerType,
        } as any,
      });

      return {
        accrualRunId: accrualRun.id,
        status: AccrualStatus.COMPLETED,
        processedCount,
        failedCount,
        message: `Accrual completed for ${year}-${month.toString().padStart(2, '0')}`,
      };
    } catch (error) {
      // Mark run as failed
      await this.prisma.leaveAccrualRun.update({
        where: { id: accrualRun.id },
        data: {
          status: AccrualStatus.FAILED,
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });

      this.logger.error(`Accrual run ${accrualRun.id} failed: ${(error as Error).message}`);
      throw error;
    }
  }

  private async sendAccrualNotifications(
    tenantId: string,
    batch: { employeeId: string; accruals: string[] }[],
  ) {
    for (const item of batch) {
      try {
        const message = `Your leave balances have been updated:\n${item.accruals.join('\n')}`;
        await this.notificationsService.notifyEmployee(
          tenantId,
          item.employeeId,
          NotificationType.LEAVE_BALANCE_UPDATED,
          'Leave Balance Updated',
          message,
          '/leave',
        );
      } catch (error) {
        this.logger.warn(
          `Failed to send notification to employee ${item.employeeId}: ${(error as Error).message}`,
        );
      }
    }
  }

  // ==========================================
  // ACCRUAL RUN QUERIES
  // ==========================================

  async getAccrualRuns(tenantId: string, query: AccrualRunQueryDto) {
    const { year, page = 1, limit = 20 } = query;
    const where: any = { tenantId };
    if (year) where.year = year;

    const [data, total] = await Promise.all([
      this.prisma.leaveAccrualRun.findMany({
        where,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          _count: { select: { accruals: true } },
        },
      }),
      this.prisma.leaveAccrualRun.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getAccrualRunById(tenantId: string, id: string) {
    const run = await this.prisma.leaveAccrualRun.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { accruals: true } },
      },
    });

    if (!run) {
      throw new NotFoundException('Accrual run not found');
    }

    return run;
  }

  async getAccrualRunEntries(
    tenantId: string,
    runId: string,
    page = 1,
    limit = 50,
  ) {
    const run = await this.getAccrualRunById(tenantId, runId);

    const [data, total] = await Promise.all([
      this.prisma.leaveAccrualEntry.findMany({
        where: { tenantId, accrualRunId: runId },
        orderBy: [
          { employee: { firstName: 'asc' } },
          { leaveType: { name: 'asc' } },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
          leaveType: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.leaveAccrualEntry.count({
        where: { tenantId, accrualRunId: runId },
      }),
    ]);

    return {
      run,
      entries: data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }
}
