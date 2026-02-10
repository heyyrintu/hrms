import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
  CreateExpenseClaimDto,
  UpdateExpenseClaimDto,
  ReviewExpenseClaimDto,
  ExpenseClaimQueryDto,
} from './dto/expense.dto';
import { ExpenseClaimStatus, NotificationType } from '@prisma/client';

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ============================================
  // Expense Categories (Admin)
  // ============================================

  async getCategories(tenantId: string) {
    return this.prisma.expenseCategory.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(tenantId: string, dto: CreateExpenseCategoryDto) {
    const existing = await this.prisma.expenseCategory.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException(`Category with code "${dto.code}" already exists`);
    }

    return this.prisma.expenseCategory.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        description: dto.description,
        maxAmount: dto.maxAmount,
      },
    });
  }

  async updateCategory(tenantId: string, id: string, dto: UpdateExpenseCategoryDto) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id, tenantId },
    });
    if (!category) throw new NotFoundException('Expense category not found');

    if (dto.code && dto.code !== category.code) {
      const existing = await this.prisma.expenseCategory.findUnique({
        where: { tenantId_code: { tenantId, code: dto.code } },
      });
      if (existing) {
        throw new ConflictException(`Category with code "${dto.code}" already exists`);
      }
    }

    return this.prisma.expenseCategory.update({
      where: { id },
      data: dto,
    });
  }

  async deleteCategory(tenantId: string, id: string) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id, tenantId },
    });
    if (!category) throw new NotFoundException('Expense category not found');

    const claimCount = await this.prisma.expenseClaim.count({
      where: { categoryId: id },
    });
    if (claimCount > 0) {
      throw new BadRequestException(
        'Cannot delete category with existing claims. Deactivate it instead.',
      );
    }

    await this.prisma.expenseCategory.delete({ where: { id } });
  }

  // ============================================
  // My Claims (Employee)
  // ============================================

  async getMyClaims(tenantId: string, employeeId: string, query: ExpenseClaimQueryDto) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const where: any = { tenantId, employeeId };
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.expenseClaim.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseClaim.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async createClaim(tenantId: string, employeeId: string, dto: CreateExpenseClaimDto) {
    const category = await this.prisma.expenseCategory.findFirst({
      where: { id: dto.categoryId, tenantId, isActive: true },
    });
    if (!category) throw new NotFoundException('Expense category not found or inactive');

    if (category.maxAmount && dto.amount > Number(category.maxAmount)) {
      throw new BadRequestException(
        `Amount exceeds maximum allowed for this category (${category.maxAmount})`,
      );
    }

    return this.prisma.expenseClaim.create({
      data: {
        tenantId,
        employeeId,
        categoryId: dto.categoryId,
        amount: dto.amount,
        description: dto.description,
        expenseDate: new Date(dto.expenseDate),
        receiptId: dto.receiptId || null,
      },
      include: {
        category: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async updateClaim(
    tenantId: string,
    employeeId: string,
    claimId: string,
    dto: UpdateExpenseClaimDto,
  ) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId },
    });
    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.employeeId !== employeeId) {
      throw new ForbiddenException('You can only edit your own claims');
    }
    if (claim.status !== ExpenseClaimStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT claims can be edited');
    }

    if (dto.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.categoryId, tenantId, isActive: true },
      });
      if (!category) throw new NotFoundException('Expense category not found or inactive');

      const amount = dto.amount ?? Number(claim.amount);
      if (category.maxAmount && amount > Number(category.maxAmount)) {
        throw new BadRequestException(
          `Amount exceeds maximum allowed for this category (${category.maxAmount})`,
        );
      }
    }

    const updateData: any = { ...dto };
    if (dto.expenseDate) updateData.expenseDate = new Date(dto.expenseDate);

    return this.prisma.expenseClaim.update({
      where: { id: claimId },
      data: updateData,
      include: {
        category: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async submitClaim(tenantId: string, employeeId: string, claimId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId },
    });
    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.employeeId !== employeeId) {
      throw new ForbiddenException('You can only submit your own claims');
    }
    if (claim.status !== ExpenseClaimStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT claims can be submitted');
    }

    const updated = await this.prisma.expenseClaim.update({
      where: { id: claimId },
      data: { status: ExpenseClaimStatus.SUBMITTED },
      include: {
        category: { select: { id: true, name: true, code: true } },
      },
    });

    // Notify HR about new expense claim
    this.notificationsService
      .notifyByRole(
        tenantId,
        ['HR_ADMIN'],
        NotificationType.EXPENSE_APPROVED,
        'New Expense Claim Submitted',
        `An expense claim of ${claim.amount} has been submitted for review.`,
        '/approvals/expenses',
      )
      .catch(() => {});

    return updated;
  }

  async deleteClaim(tenantId: string, employeeId: string, claimId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId },
    });
    if (!claim) throw new NotFoundException('Expense claim not found');
    if (claim.employeeId !== employeeId) {
      throw new ForbiddenException('You can only delete your own claims');
    }
    if (claim.status !== ExpenseClaimStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT claims can be deleted');
    }

    await this.prisma.expenseClaim.delete({ where: { id: claimId } });
  }

  // ============================================
  // Approvals (HR / Manager)
  // ============================================

  async getPendingApprovals(
    tenantId: string,
    approverEmployeeId: string,
    approverRole: string,
    query: ExpenseClaimQueryDto,
  ) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');

    const where: any = { tenantId, status: ExpenseClaimStatus.SUBMITTED };

    // Managers can only see direct reports' claims
    if (approverRole === 'MANAGER') {
      where.employee = { managerId: approverEmployeeId };
    }

    const [data, total] = await Promise.all([
      this.prisma.expenseClaim.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, code: true } },
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
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseClaim.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getAllClaims(tenantId: string, query: ExpenseClaimQueryDto) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');
    const where: any = { tenantId };
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      this.prisma.expenseClaim.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, code: true } },
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
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseClaim.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async approveClaim(
    tenantId: string,
    claimId: string,
    approverId: string,
    approverRole: string,
    dto: ReviewExpenseClaimDto,
  ) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId, status: ExpenseClaimStatus.SUBMITTED },
      include: {
        employee: { select: { id: true, managerId: true } },
      },
    });
    if (!claim) {
      throw new NotFoundException('Expense claim not found or already processed');
    }

    if (approverRole === 'MANAGER') {
      if (claim.employee.managerId !== approverId) {
        throw new ForbiddenException(
          'You can only approve expense claims for your direct reports',
        );
      }
    }

    const updated = await this.prisma.expenseClaim.update({
      where: { id: claimId },
      data: {
        status: ExpenseClaimStatus.APPROVED,
        approverId,
        approverNote: dto.approverNote,
        approvedAt: new Date(),
      },
    });

    this.notificationsService
      .notifyEmployee(
        tenantId,
        claim.employeeId,
        NotificationType.EXPENSE_APPROVED,
        'Expense Claim Approved',
        `Your expense claim of ${claim.amount} has been approved.`,
        '/expenses',
      )
      .catch(() => {});

    return updated;
  }

  async rejectClaim(
    tenantId: string,
    claimId: string,
    approverId: string,
    approverRole: string,
    dto: ReviewExpenseClaimDto,
  ) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId, status: ExpenseClaimStatus.SUBMITTED },
      include: {
        employee: { select: { id: true, managerId: true } },
      },
    });
    if (!claim) {
      throw new NotFoundException('Expense claim not found or already processed');
    }

    if (approverRole === 'MANAGER') {
      if (claim.employee.managerId !== approverId) {
        throw new ForbiddenException(
          'You can only reject expense claims for your direct reports',
        );
      }
    }

    const updated = await this.prisma.expenseClaim.update({
      where: { id: claimId },
      data: {
        status: ExpenseClaimStatus.REJECTED,
        approverId,
        approverNote: dto.approverNote,
      },
    });

    this.notificationsService
      .notifyEmployee(
        tenantId,
        claim.employeeId,
        NotificationType.EXPENSE_REJECTED,
        'Expense Claim Rejected',
        `Your expense claim of ${claim.amount} has been rejected.${dto.approverNote ? ' Note: ' + dto.approverNote : ''}`,
        '/expenses',
      )
      .catch(() => {});

    return updated;
  }

  async markReimbursed(tenantId: string, claimId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId, status: ExpenseClaimStatus.APPROVED },
    });
    if (!claim) {
      throw new NotFoundException('Expense claim not found or not in APPROVED status');
    }

    const updated = await this.prisma.expenseClaim.update({
      where: { id: claimId },
      data: {
        status: ExpenseClaimStatus.REIMBURSED,
        reimbursedAt: new Date(),
      },
    });

    this.notificationsService
      .notifyEmployee(
        tenantId,
        claim.employeeId,
        NotificationType.EXPENSE_REIMBURSED,
        'Expense Reimbursed',
        `Your expense claim of ${claim.amount} has been reimbursed.`,
        '/expenses',
      )
      .catch(() => {});

    return updated;
  }
}
