import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollCalculationService, PayslipData } from './payroll-calculation.service';
import {
  CreatePayrollRunDto,
  PayrollRunQueryDto,
  PayslipQueryDto,
} from './dto/payroll.dto';
import { PayrollRunStatus, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { isPrismaError, PRISMA_RECORD_NOT_FOUND } from '../../common/utils/prisma-errors';

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private calculationService: PayrollCalculationService,
  ) {}

  // ============================================
  // Payroll Runs
  // ============================================

  async getRuns(tenantId: string, query: PayrollRunQueryDto) {
    const where: any = { tenantId };
    if (query.year) where.year = parseInt(query.year);
    if (query.status) where.status = query.status;

    return this.prisma.payrollRun.findMany({
      where,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: {
        _count: { select: { payslips: true } },
      },
    });
  }

  async getRun(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
      include: {
        payslips: {
          include: {
            employee: {
              select: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                designation: true,
                department: { select: { name: true } },
              },
            },
          },
          orderBy: { employee: { firstName: 'asc' } },
        },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  async createRun(tenantId: string, dto: CreatePayrollRunDto) {
    // Check for duplicate
    const existing = await this.prisma.payrollRun.findUnique({
      where: {
        tenantId_month_year: {
          tenantId,
          month: dto.month,
          year: dto.year,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Payroll run for ${dto.month}/${dto.year} already exists`,
      );
    }

    return this.prisma.payrollRun.create({
      data: {
        tenantId,
        month: dto.month,
        year: dto.year,
        remarks: dto.remarks,
      },
    });
  }

  async processRun(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot process run in ${run.status} status. Only DRAFT runs can be processed.`,
      );
    }

    // Claim the run atomically: only one caller can move DRAFT -> PROCESSING.
    // A second concurrent call finds no DRAFT row to update and gets a 409
    // instead of wiping and regenerating payslips underneath the first.
    try {
      await this.prisma.payrollRun.update({
        where: { id, status: PayrollRunStatus.DRAFT },
        data: { status: PayrollRunStatus.PROCESSING },
      });
    } catch (err) {
      if (isPrismaError(err, PRISMA_RECORD_NOT_FOUND)) {
        throw new ConflictException('Payroll run is already being processed');
      }
      throw err;
    }

    try {
      // Get all active employees with salary assignments
      const employees = await this.prisma.employee.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true },
      });

      // Compute every payslip first (reads only), so the write transaction
      // below stays short and cannot time out mid-run on a large tenant.
      const results: PayslipData[] = [];
      for (const emp of employees) {
        const result = await this.calculationService.calculateForEmployee(
          tenantId,
          emp.id,
          run.month,
          run.year,
        );
        if (result) results.push(result); // No salary assigned, skip
      }

      // Totals are summed as exact decimals, so they always match the sum of
      // the payslip line items rather than drifting by fractions of a paisa.
      const totalGross = results.reduce(
        (sum, r) => sum.add(r.grossPay),
        new Decimal(0),
      );
      const totalDeductions = results.reduce(
        (sum, r) => sum.add(r.totalDeductions),
        new Decimal(0),
      );
      const totalNet = results.reduce(
        (sum, r) => sum.add(r.netPay),
        new Decimal(0),
      );

      // Replace the payslips and publish the totals atomically: a failure part
      // way through must not leave a half-generated run behind.
      return await this.prisma.$transaction(async (tx) => {
        await tx.payslip.deleteMany({ where: { payrollRunId: id } });

        if (results.length > 0) {
          await tx.payslip.createMany({
            data: results.map((result) => ({
              tenantId,
              payrollRunId: id,
              employeeId: result.employeeId,
              workingDays: result.workingDays,
              presentDays: result.presentDays,
              leaveDays: result.leaveDays,
              lopDays: result.lopDays,
              otHours: result.otHours,
              basePay: result.basePay,
              // JSON columns cannot hold Decimal; these are already rounded to
              // paise, so a number round-trips exactly at this magnitude.
              earnings: result.earnings.map((e) => ({
                name: e.name,
                amount: e.amount.toNumber(),
              })) as any,
              deductions: result.deductions.map((d) => ({
                name: d.name,
                amount: d.amount.toNumber(),
              })) as any,
              grossPay: result.grossPay,
              totalDeductions: result.totalDeductions,
              netPay: result.netPay,
              otPay: result.otPay,
              pfWages: result.statutory.pfWages,
              pfEmployee: result.statutory.pfEmployee,
              pfEmployer: result.statutory.pfEmployer,
              epsEmployer: result.statutory.epsEmployer,
              edliEmployer: result.statutory.edliEmployer,
              pfAdminEmployer: result.statutory.pfAdminEmployer,
              esiWages: result.statutory.esiWages,
              esiEmployee: result.statutory.esiEmployee,
              esiEmployer: result.statutory.esiEmployer,
              professionalTax: result.statutory.professionalTax,
              lwfEmployee: result.statutory.lwfEmployee,
              lwfEmployer: result.statutory.lwfEmployer,
              tds: result.statutory.tds,
              taxComputation: (result.statutory.taxComputation ?? undefined) as any,
            })),
          });
        }

        return tx.payrollRun.update({
          where: { id },
          data: {
            status: PayrollRunStatus.COMPUTED,
            totalGross,
            totalDeductions,
            totalNet,
            processedCount: results.length,
            processedAt: new Date(),
          },
          include: {
            _count: { select: { payslips: true } },
          },
        });
      });
    } catch (error) {
      // Revert to DRAFT on failure
      await this.prisma.payrollRun.update({
        where: { id },
        data: { status: PayrollRunStatus.DRAFT },
      });
      throw error;
    }
  }

  /**
   * Release a run that is stuck in PROCESSING.
   *
   * The claim that moves DRAFT -> PROCESSING is deliberately outside the write
   * transaction so it acts as a lock. That means a hard crash (pod restart, OOM)
   * between the claim and the commit leaves the run PROCESSING forever, with no
   * payslips, and every retry refused. This is the manual way out.
   */
  async resetRun(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.PROCESSING) {
      throw new BadRequestException(
        `Only a run stuck in PROCESSING can be reset. This run is ${run.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Any payslips from the abandoned attempt are discarded so the rerun
      // starts clean.
      await tx.payslip.deleteMany({ where: { payrollRunId: id } });
      return tx.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.DRAFT,
          processedCount: 0,
          processedAt: null,
        },
      });
    });
  }

  async approveRun(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.COMPUTED) {
      throw new BadRequestException(
        `Cannot approve run in ${run.status} status. Only COMPUTED runs can be approved.`,
      );
    }

    return this.prisma.payrollRun.update({
      where: { id },
      data: {
        status: PayrollRunStatus.APPROVED,
        approvedAt: new Date(),
      },
    });
  }

  async markAsPaid(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot mark as paid. Only APPROVED runs can be marked as paid.`,
      );
    }

    return this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollRunStatus.PAID },
    });
  }

  async deleteRun(tenantId: string, id: string, userRole?: UserRole) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');

    // An approved or paid run is a financial record. Deleting it takes its
    // payslips with it and leaves no trace that people were paid, which no
    // role should be able to do. Corrections belong in a supplementary run.
    if (
      run.status === PayrollRunStatus.PAID ||
      run.status === PayrollRunStatus.APPROVED
    ) {
      throw new BadRequestException(
        `A ${run.status} payroll run cannot be deleted; it is the record of what was paid.`,
      );
    }
    if (userRole !== UserRole.SUPER_ADMIN && run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT runs can be deleted');
    }

    // Both writes together: a half-deleted run would leave orphaned payslips.
    await this.prisma.$transaction(async (tx) => {
      await tx.payslip.deleteMany({ where: { payrollRunId: id } });
      await tx.payrollRun.delete({ where: { id } });
    });
  }

  // ============================================
  // Payslips
  // ============================================

  async getPayslipsForRun(
    tenantId: string,
    runId: string,
    query: PayslipQueryDto,
  ) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '50');

    const [data, total] = await Promise.all([
      this.prisma.payslip.findMany({
        where: { tenantId, payrollRunId: runId },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              designation: true,
              department: { select: { name: true } },
            },
          },
        },
        orderBy: { employee: { firstName: 'asc' } },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payslip.count({
        where: { tenantId, payrollRunId: runId },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getMyPayslips(tenantId: string, employeeId: string) {
    if (!employeeId) {
      throw new BadRequestException(
        'No employee profile linked to this user',
      );
    }

    return this.prisma.payslip.findMany({
      where: {
        tenantId,
        employeeId,
        payrollRun: {
          status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
        },
      },
      include: {
        payrollRun: {
          select: { month: true, year: true, status: true },
        },
      },
      orderBy: [
        { payrollRun: { year: 'desc' } },
        { payrollRun: { month: 'desc' } },
      ],
    });
  }

  async getPayslip(tenantId: string, id: string) {
    const payslip = await this.prisma.payslip.findFirst({
      where: { id, tenantId },
      include: {
        employee: {
          select: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            email: true,
            designation: true,
            department: { select: { name: true } },
            joinDate: true,
          },
        },
        payrollRun: {
          select: { month: true, year: true, status: true },
        },
      },
    });
    if (!payslip) throw new NotFoundException('Payslip not found');
    return payslip;
  }

  async getEmployeePayslips(tenantId: string, employeeId: string) {
    return this.prisma.payslip.findMany({
      where: {
        tenantId,
        employeeId,
        payrollRun: {
          status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
        },
      },
      include: {
        payrollRun: {
          select: { month: true, year: true, status: true },
        },
      },
      orderBy: [
        { payrollRun: { year: 'desc' } },
        { payrollRun: { month: 'desc' } },
      ],
    });
  }
}
