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
import { ExpenseClaimStatus, NotificationType, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { WorkflowEntityContext } from '../workflow/workflow.types';

/** Route of the per-flow approvals page for expense claims. */
export const EXPENSE_APPROVALS_LINK = '/approvals/expenses';

function isAdmin(role: UserRole | string): boolean {
  return role === UserRole.SUPER_ADMIN || role === UserRole.HR_ADMIN;
}

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private workflow: ApprovalEngineService,
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

    // Re-validate the category limit whenever the category OR the amount changes;
    // checking only on a category change let an amount-only edit bypass the cap.
    if (dto.categoryId || dto.amount !== undefined) {
      const categoryId = dto.categoryId ?? claim.categoryId;
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: categoryId, tenantId, isActive: true },
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

    const requesterUserId = await this.userIdOfEmployee(tenantId, employeeId);

    // The status change and the approval instance commit together; step-1
    // approvers are notified by the engine once the transaction is done.
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.expenseClaim.update({
        where: { id: claimId },
        data: { status: ExpenseClaimStatus.SUBMITTED },
        include: {
          category: { select: { id: true, name: true, code: true } },
        },
      });
      await this.workflow.start({
        tenantId,
        entityType: 'EXPENSE',
        entityId: claimId,
        context: {
          requesterEmployeeId: employeeId,
          requesterUserId,
          amount: Number(claim.amount),
        },
        tx,
      });
      return result;
    });

    void this.workflow.notifyPending(tenantId, 'EXPENSE', claimId);

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

  /**
   * HR_ADMIN / SUPER_ADMIN see every submitted claim; everyone else sees the
   * claims whose current approval step they can act on (reporting manager,
   * later-step approver, delegate, leave cover).
   */
  async getPendingApprovals(actor: AuthenticatedUser, query: ExpenseClaimQueryDto) {
    const page = parseInt(query.page || '1');
    const limit = parseInt(query.limit || '20');

    const where: any = { tenantId: actor.tenantId, status: ExpenseClaimStatus.SUBMITTED };

    if (!isAdmin(actor.role)) {
      const ids = await this.workflow.listActionableEntityIds(actor, 'EXPENSE');
      where.id = { in: ids };
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

  /**
   * Approve through the approval engine, which authorizes the actor. On an
   * intermediate step the claim stays SUBMITTED and is returned unchanged; on
   * the last step it becomes APPROVED inside the engine's transaction.
   */
  async approveClaim(actor: AuthenticatedUser, claimId: string, dto: ReviewExpenseClaimDto) {
    const { tenantId } = actor;
    const claim = await this.findSubmittedClaim(tenantId, claimId);

    let updated: unknown = null;
    const result = await this.workflow.act({
      tenantId,
      entityType: 'EXPENSE',
      entityId: claimId,
      actor,
      decision: 'APPROVE',
      note: dto.approverNote,
      onFinal: async (tx) => {
        updated = await tx.expenseClaim.update({
          where: { id: claimId },
          data: {
            status: ExpenseClaimStatus.APPROVED,
            approverId: actor.employeeId ?? null,
            approverNote: dto.approverNote,
            approvedAt: new Date(),
          },
        });
      },
    });

    if (result.outcome === 'ADVANCED') {
      return claim;
    }

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

  /** Reject through the approval engine; a rejection on any step ends the request. */
  async rejectClaim(actor: AuthenticatedUser, claimId: string, dto: ReviewExpenseClaimDto) {
    const { tenantId } = actor;
    const claim = await this.findSubmittedClaim(tenantId, claimId);

    let updated: unknown = null;
    await this.workflow.act({
      tenantId,
      entityType: 'EXPENSE',
      entityId: claimId,
      actor,
      decision: 'REJECT',
      note: dto.approverNote,
      onFinal: async (tx) => {
        updated = await tx.expenseClaim.update({
          where: { id: claimId },
          data: {
            status: ExpenseClaimStatus.REJECTED,
            approverId: actor.employeeId ?? null,
            approverNote: dto.approverNote,
          },
        });
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

  // ============================================
  // Approval workflow support
  // ============================================

  /** Engine routing context of a SUBMITTED claim; null otherwise. */
  async getWorkflowContext(
    tenantId: string,
    claimId: string,
  ): Promise<WorkflowEntityContext | null> {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId, status: ExpenseClaimStatus.SUBMITTED },
      select: { employeeId: true, amount: true },
    });
    if (!claim) return null;
    return {
      requesterEmployeeId: claim.employeeId,
      requesterUserId: await this.userIdOfEmployee(tenantId, claim.employeeId),
      amount: Number(claim.amount),
    };
  }

  private async findSubmittedClaim(tenantId: string, claimId: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id: claimId, tenantId, status: ExpenseClaimStatus.SUBMITTED },
    });
    if (!claim) {
      throw new NotFoundException('Expense claim not found or already processed');
    }
    return claim;
  }

  private async userIdOfEmployee(tenantId: string, employeeId: string): Promise<string | null> {
    const user = await this.prisma.user.findFirst({
      where: { tenantId, employeeId },
      select: { id: true },
    });
    return user?.id ?? null;
  }
}
