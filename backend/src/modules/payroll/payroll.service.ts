import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import {
  CreatePayrollRunDto,
  PayrollRunQueryDto,
  PayslipQueryDto,
} from './dto/payroll.dto';
import { PayrollRunStatus } from '@prisma/client';

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

    // Mark as processing
    await this.prisma.payrollRun.update({
      where: { id },
      data: { status: PayrollRunStatus.PROCESSING },
    });

    try {
      // Get all active employees with salary assignments
      const employees = await this.prisma.employee.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true },
      });

      // Delete any previous payslips for this run
      await this.prisma.payslip.deleteMany({
        where: { payrollRunId: id },
      });

      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      let processedCount = 0;

      for (const emp of employees) {
        const result = await this.calculationService.calculateForEmployee(
          tenantId,
          emp.id,
          run.month,
          run.year,
        );

        if (!result) continue; // No salary assigned, skip

        await this.prisma.payslip.create({
          data: {
            tenantId,
            payrollRunId: id,
            employeeId: result.employeeId,
            workingDays: result.workingDays,
            presentDays: result.presentDays,
            leaveDays: result.leaveDays,
            lopDays: result.lopDays,
            otHours: result.otHours,
            basePay: result.basePay,
            earnings: result.earnings as any,
            deductions: result.deductions as any,
            grossPay: result.grossPay,
            totalDeductions: result.totalDeductions,
            netPay: result.netPay,
            otPay: result.otPay,
          },
        });

        totalGross += result.grossPay;
        totalDeductions += result.totalDeductions;
        totalNet += result.netPay;
        processedCount++;
      }

      // Update run with totals
      return this.prisma.payrollRun.update({
        where: { id },
        data: {
          status: PayrollRunStatus.COMPUTED,
          totalGross: Math.round(totalGross * 100) / 100,
          totalDeductions: Math.round(totalDeductions * 100) / 100,
          totalNet: Math.round(totalNet * 100) / 100,
          processedCount,
          processedAt: new Date(),
        },
        include: {
          _count: { select: { payslips: true } },
        },
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

  async deleteRun(tenantId: string, id: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id, tenantId },
    });
    if (!run) throw new NotFoundException('Payroll run not found');
    if (run.status !== PayrollRunStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT runs can be deleted');
    }

    await this.prisma.payslip.deleteMany({ where: { payrollRunId: id } });
    await this.prisma.payrollRun.delete({ where: { id } });
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
}
