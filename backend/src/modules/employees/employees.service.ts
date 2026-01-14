import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto, EmployeeQueryDto } from './dto/employee.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new employee
   */
  async create(tenantId: string, dto: CreateEmployeeDto) {
    // Check if employee code or email already exists
    const existing = await this.prisma.employee.findFirst({
      where: {
        tenantId,
        OR: [
          { employeeCode: dto.employeeCode },
          { email: dto.email },
        ],
      },
    });

    if (existing) {
      throw new ConflictException(
        existing.employeeCode === dto.employeeCode
          ? 'Employee code already exists'
          : 'Email already exists',
      );
    }

    // If creating user, check if user email already exists
    if (dto.createUser && dto.userEmail) {
      const existingUser = await this.prisma.user.findFirst({
        where: {
          tenantId,
          email: dto.userEmail,
        },
      });

      if (existingUser) {
        throw new ConflictException('User email already exists');
      }
    }

    // Create employee and user in a transaction
    return this.prisma.$transaction(async (prisma) => {
      const employee = await prisma.employee.create({
        data: {
          tenantId,
          employeeCode: dto.employeeCode,
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          employmentType: dto.employmentType || 'PERMANENT',
          payType: dto.payType || 'MONTHLY',
          hourlyRate: dto.hourlyRate,
          otMultiplier: dto.otMultiplier || 1.5,
          departmentId: dto.departmentId,
          designation: dto.designation,
          managerId: dto.managerId,
          joinDate: new Date(dto.joinDate),
          exitDate: dto.exitDate ? new Date(dto.exitDate) : null,
          status: dto.status || 'ACTIVE',
        },
        include: {
          department: true,
          manager: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Create user account if requested
      if (dto.createUser && dto.userEmail && dto.userPassword) {
        const passwordHash = await bcrypt.hash(dto.userPassword, 10);
        
        await prisma.user.create({
          data: {
            tenantId,
            email: dto.userEmail,
            passwordHash,
            role: dto.userRole || 'EMPLOYEE',
            employeeId: employee.id,
            isActive: true,
          },
        });
      }

      return employee;
    });
  }

  /**
   * Get all employees with pagination and filters
   */
  async findAll(tenantId: string, query: EmployeeQueryDto) {
    const { search, departmentId, status, employmentType, page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where = {
      tenantId,
      ...(departmentId && { departmentId }),
      ...(status && { status }),
      ...(employmentType && { employmentType }),
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
          { employeeCode: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [employees, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          department: true,
          manager: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data: employees,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get employee by ID
   */
  async findOne(tenantId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id, tenantId },
      include: {
        department: true,
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        directReports: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            designation: true,
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return employee;
  }

  /**
   * Get Employee 360 view with aggregated data
   */
  async get360View(tenantId: string, id: string) {
    const employee = await this.findOne(tenantId, id);

    // Get attendance summary for current month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const attendanceRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId,
        employeeId: id,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
    });

    const attendanceSummary = {
      presentDays: attendanceRecords.filter((r) => r.status === 'PRESENT').length,
      absentDays: attendanceRecords.filter((r) => r.status === 'ABSENT').length,
      leaveDays: attendanceRecords.filter((r) => r.status === 'LEAVE').length,
      wfhDays: attendanceRecords.filter((r) => r.status === 'WFH').length,
      totalWorkedMinutes: attendanceRecords.reduce((sum, r) => sum + r.workedMinutes, 0),
      totalOtMinutes: attendanceRecords.reduce((sum, r) => sum + r.otMinutesCalculated, 0),
      totalApprovedOtMinutes: attendanceRecords.reduce(
        (sum, r) => sum + (r.otMinutesApproved || 0),
        0,
      ),
    };

    // Get leave balances for current year
    const leaveBalances = await this.prisma.leaveBalance.findMany({
      where: {
        tenantId,
        employeeId: id,
        year: now.getFullYear(),
      },
      include: {
        leaveType: true,
      },
    });

    // Get pending leave requests
    const pendingLeaveRequests = await this.prisma.leaveRequest.count({
      where: {
        tenantId,
        employeeId: id,
        status: 'PENDING',
      },
    });

    return {
      employee,
      attendanceSummary,
      leaveBalances,
      pendingLeaveRequests,
    };
  }

  /**
   * Update employee
   */
  async update(tenantId: string, id: string, dto: UpdateEmployeeDto) {
    await this.findOne(tenantId, id);

    // Check for email conflict if updating email
    if (dto.email) {
      const existing = await this.prisma.employee.findFirst({
        where: {
          tenantId,
          email: dto.email,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException('Email already exists');
      }
    }

    return this.prisma.employee.update({
      where: { id },
      data: {
        ...dto,
        exitDate: dto.exitDate ? new Date(dto.exitDate) : undefined,
      },
      include: {
        department: true,
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Delete employee (soft delete by setting status to INACTIVE)
   */
  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);

    return this.prisma.employee.update({
      where: { id },
      data: {
        status: 'INACTIVE',
        exitDate: new Date(),
      },
    });
  }

  /**
   * Get employees managed by a specific manager
   */
  async getDirectReports(tenantId: string, managerId: string) {
    return this.prisma.employee.findMany({
      where: {
        tenantId,
        managerId,
        status: 'ACTIVE',
      },
      include: {
        department: true,
      },
    });
  }
}
