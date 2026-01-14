import { Injectable, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto, CompanyQueryDto } from './dto/company.dto';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new company/tenant with initial admin user
   */
  async create(dto: CreateCompanyDto) {
    // Check if company code already exists
    const existingCode = await this.prisma.tenant.findUnique({
      where: { code: dto.code },
    });

    if (existingCode) {
      throw new ConflictException('Company code already exists');
    }

    // Check if admin email already exists globally
    const existingEmail = await this.prisma.user.findFirst({
      where: { email: dto.adminEmail },
    });

    if (existingEmail) {
      throw new ConflictException('Admin email already exists in the system');
    }

    // Create company with initial admin in a transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Create the tenant/company
      const company = await tx.tenant.create({
        data: {
          name: dto.name,
          code: dto.code,
        },
      });

      // Create the initial admin employee
      const employee = await tx.employee.create({
        data: {
          tenantId: company.id,
          employeeCode: 'ADMIN-001',
          firstName: dto.adminFirstName,
          lastName: dto.adminLastName,
          email: dto.adminEmail,
          employmentType: 'PERMANENT',
          payType: 'MONTHLY',
          joinDate: new Date(),
          status: 'ACTIVE',
        },
      });

      // Create the admin user
      const passwordHash = await bcrypt.hash(dto.adminPassword, 10);
      const user = await tx.user.create({
        data: {
          tenantId: company.id,
          email: dto.adminEmail,
          passwordHash,
          role: UserRole.HR_ADMIN,
          employeeId: employee.id,
          isActive: true,
        },
      });

      // Create default leave types for the company
      await tx.leaveType.createMany({
        data: [
          {
            tenantId: company.id,
            name: 'Annual Leave',
            code: 'AL',
            description: 'Annual paid leave',
            defaultDays: 20,
            carryForward: true,
            maxCarryForward: 5,
            isPaid: true,
          },
          {
            tenantId: company.id,
            name: 'Sick Leave',
            code: 'SL',
            description: 'Sick leave with medical certificate',
            defaultDays: 10,
            carryForward: false,
            isPaid: true,
          },
          {
            tenantId: company.id,
            name: 'Casual Leave',
            code: 'CL',
            description: 'Casual leave for personal matters',
            defaultDays: 5,
            carryForward: false,
            isPaid: true,
          },
        ],
      });

      // Create default OT rule
      await tx.otRule.create({
        data: {
          tenantId: company.id,
          name: 'Standard OT Rule',
          dailyThresholdMinutes: 480, // 8 hours
          roundingIntervalMinutes: 15,
          requiresManagerApproval: true,
        },
      });

      return {
        company,
        admin: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      };
    });

    return result;
  }

  /**
   * Get all companies with optional filtering
   */
  async findAll(query: CompanyQueryDto) {
    const { search, isActive } = query;

    const where = {
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { code: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const companies = await this.prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            employees: true,
            users: true,
            departments: true,
          },
        },
      },
    });

    return companies.map((company) => ({
      ...company,
      employeeCount: company._count.employees,
      userCount: company._count.users,
      departmentCount: company._count.departments,
      _count: undefined,
    }));
  }

  /**
   * Get company by ID with statistics
   */
  async findOne(id: string) {
    const company = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            employees: true,
            users: true,
            departments: true,
            leaveTypes: true,
            otRules: true,
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    // Get additional stats
    const activeEmployees = await this.prisma.employee.count({
      where: { tenantId: id, status: 'ACTIVE' },
    });

    return {
      ...company,
      employeeCount: company._count.employees,
      activeEmployeeCount: activeEmployees,
      userCount: company._count.users,
      departmentCount: company._count.departments,
      leaveTypeCount: company._count.leaveTypes,
      otRuleCount: company._count.otRules,
      _count: undefined,
    };
  }

  /**
   * Update company details
   */
  async update(id: string, dto: UpdateCompanyDto) {
    await this.findOne(id);

    return this.prisma.tenant.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * Toggle company active status
   */
  async toggleStatus(id: string) {
    const company = await this.findOne(id);

    return this.prisma.tenant.update({
      where: { id },
      data: { isActive: !company.isActive },
    });
  }

  /**
   * Delete company (only if it has no data)
   */
  async remove(id: string) {
    const company = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            employees: true,
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException('Company not found');
    }

    if (company._count.employees > 0) {
      throw new ForbiddenException(
        'Cannot delete company with existing employees. Deactivate it instead.',
      );
    }

    // Delete in order due to foreign key constraints
    await this.prisma.$transaction(async (tx) => {
      await tx.otRule.deleteMany({ where: { tenantId: id } });
      await tx.leaveType.deleteMany({ where: { tenantId: id } });
      await tx.user.deleteMany({ where: { tenantId: id } });
      await tx.department.deleteMany({ where: { tenantId: id } });
      await tx.tenant.delete({ where: { id } });
    });

    return { message: 'Company deleted successfully' };
  }

  /**
   * Get company statistics summary
   */
  async getStatsSummary() {
    const [totalCompanies, activeCompanies, totalEmployees, totalUsers] =
      await Promise.all([
        this.prisma.tenant.count(),
        this.prisma.tenant.count({ where: { isActive: true } }),
        this.prisma.employee.count(),
        this.prisma.user.count(),
      ]);

    return {
      totalCompanies,
      activeCompanies,
      inactiveCompanies: totalCompanies - activeCompanies,
      totalEmployees,
      totalUsers,
    };
  }
}
