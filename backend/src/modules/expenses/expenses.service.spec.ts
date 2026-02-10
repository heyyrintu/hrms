import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let prisma: any;
  let notifications: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();

    service = module.get<ExpensesService>(ExpensesService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // Expense Categories
  // ============================================

  describe('getCategories', () => {
    it('should return categories for a tenant', async () => {
      const categories = [{ id: 'cat-1', name: 'Travel' }];
      prisma.expenseCategory.findMany.mockResolvedValue(categories);

      const result = await service.getCategories('tenant-1');

      expect(prisma.expenseCategory.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(categories);
    });
  });

  describe('createCategory', () => {
    it('should create a new category', async () => {
      prisma.expenseCategory.findUnique.mockResolvedValue(null);
      const created = { id: 'cat-1', tenantId: 'tenant-1', name: 'Travel', code: 'TRV' };
      prisma.expenseCategory.create.mockResolvedValue(created);

      const result = await service.createCategory('tenant-1', {
        name: 'Travel',
        code: 'TRV',
        description: 'Travel expenses',
      });

      expect(prisma.expenseCategory.findUnique).toHaveBeenCalledWith({
        where: { tenantId_code: { tenantId: 'tenant-1', code: 'TRV' } },
      });
      expect(prisma.expenseCategory.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          name: 'Travel',
          code: 'TRV',
          description: 'Travel expenses',
          maxAmount: undefined,
        },
      });
      expect(result).toEqual(created);
    });

    it('should throw ConflictException when code already exists', async () => {
      prisma.expenseCategory.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createCategory('tenant-1', { name: 'Travel', code: 'TRV' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('updateCategory', () => {
    it('should update an existing category', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
        tenantId: 'tenant-1',
        code: 'TRV',
      });
      const updated = { id: 'cat-1', name: 'Updated Travel' };
      prisma.expenseCategory.update.mockResolvedValue(updated);

      const result = await service.updateCategory('tenant-1', 'cat-1', {
        name: 'Updated Travel',
      });

      expect(prisma.expenseCategory.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { name: 'Updated Travel' },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when category not found', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCategory('tenant-1', 'missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when changing code to existing one', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
        tenantId: 'tenant-1',
        code: 'TRV',
      });
      prisma.expenseCategory.findUnique.mockResolvedValue({ id: 'cat-2', code: 'FOOD' });

      await expect(
        service.updateCategory('tenant-1', 'cat-1', { code: 'FOOD' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteCategory', () => {
    it('should delete a category with no claims', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1', tenantId: 'tenant-1' });
      prisma.expenseClaim.count.mockResolvedValue(0);
      prisma.expenseCategory.delete.mockResolvedValue({});

      await service.deleteCategory('tenant-1', 'cat-1');

      expect(prisma.expenseCategory.delete).toHaveBeenCalledWith({ where: { id: 'cat-1' } });
    });

    it('should throw NotFoundException when category not found', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue(null);

      await expect(service.deleteCategory('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when category has claims', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-1', tenantId: 'tenant-1' });
      prisma.expenseClaim.count.mockResolvedValue(5);

      await expect(service.deleteCategory('tenant-1', 'cat-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // My Claims
  // ============================================

  describe('getMyClaims', () => {
    it('should return paginated claims for employee', async () => {
      const claims = [{ id: 'claim-1' }];
      prisma.expenseClaim.findMany.mockResolvedValue(claims);
      prisma.expenseClaim.count.mockResolvedValue(1);

      const result = await service.getMyClaims('tenant-1', 'emp-1', {});

      expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1' },
        include: {
          category: { select: { id: true, name: true, code: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(result).toEqual({
        data: claims,
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('should filter by status', async () => {
      prisma.expenseClaim.findMany.mockResolvedValue([]);
      prisma.expenseClaim.count.mockResolvedValue(0);

      await service.getMyClaims('tenant-1', 'emp-1', { status: 'DRAFT' as any });

      expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', employeeId: 'emp-1', status: 'DRAFT' },
        }),
      );
    });
  });

  describe('createClaim', () => {
    it('should create a claim for a valid category', async () => {
      const category = {
        id: 'cat-1',
        tenantId: 'tenant-1',
        isActive: true,
        maxAmount: null,
      };
      prisma.expenseCategory.findFirst.mockResolvedValue(category);
      const created = { id: 'claim-1', amount: 100, status: 'DRAFT' };
      prisma.expenseClaim.create.mockResolvedValue(created);

      const result = await service.createClaim('tenant-1', 'emp-1', {
        categoryId: 'cat-1',
        amount: 100,
        description: 'Lunch',
        expenseDate: '2024-01-15',
      });

      expect(prisma.expenseClaim.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          employeeId: 'emp-1',
          categoryId: 'cat-1',
          amount: 100,
          description: 'Lunch',
          expenseDate: new Date('2024-01-15'),
          receiptId: null,
        },
        include: {
          category: { select: { id: true, name: true, code: true } },
        },
      });
      expect(result).toEqual(created);
    });

    it('should throw NotFoundException when category not found', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue(null);

      await expect(
        service.createClaim('tenant-1', 'emp-1', {
          categoryId: 'missing',
          amount: 100,
          description: 'Test',
          expenseDate: '2024-01-15',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when amount exceeds max', async () => {
      prisma.expenseCategory.findFirst.mockResolvedValue({
        id: 'cat-1',
        isActive: true,
        maxAmount: 50,
      });

      await expect(
        service.createClaim('tenant-1', 'emp-1', {
          categoryId: 'cat-1',
          amount: 100,
          description: 'Over limit',
          expenseDate: '2024-01-15',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateClaim', () => {
    const draftClaim = {
      id: 'claim-1',
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      status: 'DRAFT',
      amount: 100,
    };

    it('should update a draft claim owned by the employee', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue(draftClaim);
      const updated = { ...draftClaim, description: 'Updated' };
      prisma.expenseClaim.update.mockResolvedValue(updated);

      const result = await service.updateClaim('tenant-1', 'emp-1', 'claim-1', {
        description: 'Updated',
      });

      expect(prisma.expenseClaim.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: { description: 'Updated' },
        include: { category: { select: { id: true, name: true, code: true } } },
      });
      expect(result).toEqual(updated);
    });

    it('should throw ForbiddenException when not own claim', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        ...draftClaim,
        employeeId: 'other-emp',
      });

      await expect(
        service.updateClaim('tenant-1', 'emp-1', 'claim-1', { description: 'X' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when claim not DRAFT', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        ...draftClaim,
        status: 'SUBMITTED',
      });

      await expect(
        service.updateClaim('tenant-1', 'emp-1', 'claim-1', { description: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when claim not found', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue(null);

      await expect(
        service.updateClaim('tenant-1', 'emp-1', 'missing', { description: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('submitClaim', () => {
    it('should submit a draft claim', async () => {
      const claim = {
        id: 'claim-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        status: 'DRAFT',
        amount: 100,
      };
      prisma.expenseClaim.findFirst.mockResolvedValue(claim);
      const updated = { ...claim, status: 'SUBMITTED' };
      prisma.expenseClaim.update.mockResolvedValue(updated);

      const result = await service.submitClaim('tenant-1', 'emp-1', 'claim-1');

      expect(prisma.expenseClaim.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: { status: 'SUBMITTED' },
        include: { category: { select: { id: true, name: true, code: true } } },
      });
      expect(result).toEqual(updated);
    });

    it('should throw ForbiddenException when not own claim', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        id: 'claim-1',
        employeeId: 'other-emp',
        status: 'DRAFT',
      });

      await expect(
        service.submitClaim('tenant-1', 'emp-1', 'claim-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when not DRAFT', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        id: 'claim-1',
        employeeId: 'emp-1',
        status: 'SUBMITTED',
      });

      await expect(
        service.submitClaim('tenant-1', 'emp-1', 'claim-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should notify HR after submission', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        id: 'claim-1',
        employeeId: 'emp-1',
        status: 'DRAFT',
        amount: 100,
      });
      prisma.expenseClaim.update.mockResolvedValue({ id: 'claim-1', status: 'SUBMITTED' });

      await service.submitClaim('tenant-1', 'emp-1', 'claim-1');

      expect(notifications.notifyByRole).toHaveBeenCalledWith(
        'tenant-1',
        ['HR_ADMIN'],
        expect.any(String),
        'New Expense Claim Submitted',
        expect.stringContaining('100'),
        '/approvals/expenses',
      );
    });
  });

  describe('deleteClaim', () => {
    it('should delete a draft claim owned by the employee', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        id: 'claim-1',
        employeeId: 'emp-1',
        status: 'DRAFT',
      });
      prisma.expenseClaim.delete.mockResolvedValue({});

      await service.deleteClaim('tenant-1', 'emp-1', 'claim-1');

      expect(prisma.expenseClaim.delete).toHaveBeenCalledWith({ where: { id: 'claim-1' } });
    });

    it('should throw ForbiddenException when not own claim', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        id: 'claim-1',
        employeeId: 'other-emp',
        status: 'DRAFT',
      });

      await expect(
        service.deleteClaim('tenant-1', 'emp-1', 'claim-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw BadRequestException when not DRAFT', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        id: 'claim-1',
        employeeId: 'emp-1',
        status: 'APPROVED',
      });

      await expect(
        service.deleteClaim('tenant-1', 'emp-1', 'claim-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // Approvals
  // ============================================

  describe('getPendingApprovals', () => {
    it('should return pending approvals for HR', async () => {
      prisma.expenseClaim.findMany.mockResolvedValue([]);
      prisma.expenseClaim.count.mockResolvedValue(0);

      const result = await service.getPendingApprovals('tenant-1', 'emp-hr', 'HR_ADMIN', {});

      expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', status: 'SUBMITTED' },
        }),
      );
      expect(result.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    it('should scope to direct reports for MANAGER role', async () => {
      prisma.expenseClaim.findMany.mockResolvedValue([]);
      prisma.expenseClaim.count.mockResolvedValue(0);

      await service.getPendingApprovals('tenant-1', 'emp-mgr', 'MANAGER', {});

      expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            status: 'SUBMITTED',
            employee: { managerId: 'emp-mgr' },
          },
        }),
      );
    });
  });

  describe('getAllClaims', () => {
    it('should return paginated claims', async () => {
      prisma.expenseClaim.findMany.mockResolvedValue([]);
      prisma.expenseClaim.count.mockResolvedValue(0);

      const result = await service.getAllClaims('tenant-1', { page: '2', limit: '10' });

      expect(prisma.expenseClaim.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta.page).toBe(2);
    });
  });

  describe('approveClaim', () => {
    const submittedClaim = {
      id: 'claim-1',
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      status: 'SUBMITTED',
      amount: 200,
      employee: { id: 'emp-1', managerId: 'emp-mgr' },
    };

    it('should approve a submitted claim', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue(submittedClaim);
      const updated = { ...submittedClaim, status: 'APPROVED', approverId: 'emp-hr' };
      prisma.expenseClaim.update.mockResolvedValue(updated);

      const result = await service.approveClaim(
        'tenant-1', 'claim-1', 'emp-hr', 'HR_ADMIN', { approverNote: 'OK' },
      );

      expect(prisma.expenseClaim.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: {
          status: 'APPROVED',
          approverId: 'emp-hr',
          approverNote: 'OK',
          approvedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when claim not found or already processed', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue(null);

      await expect(
        service.approveClaim('tenant-1', 'missing', 'emp-hr', 'HR_ADMIN', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when manager is not the employee manager', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        ...submittedClaim,
        employee: { id: 'emp-1', managerId: 'other-manager' },
      });

      await expect(
        service.approveClaim('tenant-1', 'claim-1', 'emp-mgr', 'MANAGER', {}),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow manager to approve their direct report claim', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue(submittedClaim);
      prisma.expenseClaim.update.mockResolvedValue({ ...submittedClaim, status: 'APPROVED' });

      await service.approveClaim('tenant-1', 'claim-1', 'emp-mgr', 'MANAGER', {});

      expect(prisma.expenseClaim.update).toHaveBeenCalled();
    });
  });

  describe('rejectClaim', () => {
    const submittedClaim = {
      id: 'claim-1',
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      status: 'SUBMITTED',
      amount: 200,
      employee: { id: 'emp-1', managerId: 'emp-mgr' },
    };

    it('should reject a submitted claim', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue(submittedClaim);
      const updated = { ...submittedClaim, status: 'REJECTED' };
      prisma.expenseClaim.update.mockResolvedValue(updated);

      const result = await service.rejectClaim(
        'tenant-1', 'claim-1', 'emp-hr', 'HR_ADMIN', { approverNote: 'Invalid receipt' },
      );

      expect(prisma.expenseClaim.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: {
          status: 'REJECTED',
          approverId: 'emp-hr',
          approverNote: 'Invalid receipt',
        },
      });
      expect(result).toEqual(updated);
    });

    it('should throw ForbiddenException for manager not managing the employee', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        ...submittedClaim,
        employee: { id: 'emp-1', managerId: 'other-manager' },
      });

      await expect(
        service.rejectClaim('tenant-1', 'claim-1', 'emp-mgr', 'MANAGER', {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('markReimbursed', () => {
    it('should mark an approved claim as reimbursed', async () => {
      const claim = {
        id: 'claim-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        status: 'APPROVED',
        amount: 200,
      };
      prisma.expenseClaim.findFirst.mockResolvedValue(claim);
      const updated = { ...claim, status: 'REIMBURSED' };
      prisma.expenseClaim.update.mockResolvedValue(updated);

      const result = await service.markReimbursed('tenant-1', 'claim-1');

      expect(prisma.expenseClaim.update).toHaveBeenCalledWith({
        where: { id: 'claim-1' },
        data: {
          status: 'REIMBURSED',
          reimbursedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when claim not approved', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue(null);

      await expect(service.markReimbursed('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should notify employee after reimbursement', async () => {
      prisma.expenseClaim.findFirst.mockResolvedValue({
        id: 'claim-1',
        employeeId: 'emp-1',
        status: 'APPROVED',
        amount: 200,
      });
      prisma.expenseClaim.update.mockResolvedValue({ id: 'claim-1', status: 'REIMBURSED' });

      await service.markReimbursed('tenant-1', 'claim-1');

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1',
        'emp-1',
        expect.any(String),
        'Expense Reimbursed',
        expect.stringContaining('200'),
        '/expenses',
      );
    });
  });
});
