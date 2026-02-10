import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getCategories: jest.fn(),
  createCategory: jest.fn(),
  updateCategory: jest.fn(),
  deleteCategory: jest.fn(),
  getMyClaims: jest.fn(),
  createClaim: jest.fn(),
  updateClaim: jest.fn(),
  submitClaim: jest.fn(),
  deleteClaim: jest.fn(),
  getPendingApprovals: jest.fn(),
  getAllClaims: jest.fn(),
  approveClaim: jest.fn(),
  rejectClaim: jest.fn(),
  markReimbursed: jest.fn(),
};

describe('ExpensesController', () => {
  let controller: ExpensesController;
  let service: typeof mockService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  const employeeUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-2',
  };

  const managerUser: AuthenticatedUser = {
    userId: 'user-3',
    email: 'manager@test.com',
    tenantId: 'tenant-1',
    role: UserRole.MANAGER,
    employeeId: 'emp-3',
  };

  const userNoEmployee: AuthenticatedUser = {
    userId: 'user-4',
    email: 'noemp@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExpensesController],
      providers: [{ provide: ExpensesService, useValue: mockService }],
    }).compile();
    controller = module.get<ExpensesController>(ExpensesController);
    service = module.get(ExpensesService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // Expense Categories (Admin)
  // ============================================
  describe('getCategories', () => {
    it('should return expense categories', async () => {
      const expected = [{ id: 'cat-1', name: 'Travel' }];
      service.getCategories.mockResolvedValue(expected);

      const result = await controller.getCategories(adminUser);

      expect(result).toEqual(expected);
      expect(service.getCategories).toHaveBeenCalledWith(adminUser.tenantId);
    });
  });

  describe('createCategory', () => {
    const dto = { name: 'Travel', code: 'TRV', description: 'Travel expenses' };

    it('should create an expense category', async () => {
      const expected = { id: 'cat-1', ...dto };
      service.createCategory.mockResolvedValue(expected);

      const result = await controller.createCategory(adminUser, dto);

      expect(result).toEqual(expected);
      expect(service.createCategory).toHaveBeenCalledWith(
        adminUser.tenantId,
        dto,
      );
    });
  });

  describe('updateCategory', () => {
    const dto = { name: 'Updated Travel' };

    it('should update an expense category', async () => {
      const expected = { id: 'cat-1', name: 'Updated Travel' };
      service.updateCategory.mockResolvedValue(expected);

      const result = await controller.updateCategory(adminUser, 'cat-1', dto);

      expect(result).toEqual(expected);
      expect(service.updateCategory).toHaveBeenCalledWith(
        adminUser.tenantId,
        'cat-1',
        dto,
      );
    });
  });

  describe('deleteCategory', () => {
    it('should delete an expense category and return message', async () => {
      service.deleteCategory.mockResolvedValue(undefined);

      const result = await controller.deleteCategory(adminUser, 'cat-1');

      expect(result).toEqual({ message: 'Expense category deleted' });
      expect(service.deleteCategory).toHaveBeenCalledWith(
        adminUser.tenantId,
        'cat-1',
      );
    });
  });

  // ============================================
  // My Claims (Employee)
  // ============================================
  describe('getMyClaims', () => {
    it('should return claims for the employee', async () => {
      const expected = { data: [{ id: 'claim-1' }], total: 1 };
      const query = { status: 'PENDING', page: '1', limit: '20' };
      service.getMyClaims.mockResolvedValue(expected);

      const result = await controller.getMyClaims(employeeUser, query);

      expect(result).toEqual(expected);
      expect(service.getMyClaims).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        query,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.getMyClaims(userNoEmployee, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('createClaim', () => {
    const dto = {
      categoryId: 'cat-1',
      amount: 150.0,
      description: 'Taxi fare',
      expenseDate: '2025-03-15',
    };

    it('should create an expense claim', async () => {
      const expected = { id: 'claim-1', ...dto };
      service.createClaim.mockResolvedValue(expected);

      const result = await controller.createClaim(employeeUser, dto);

      expect(result).toEqual(expected);
      expect(service.createClaim).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.createClaim(userNoEmployee, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateClaim', () => {
    const dto = { amount: 200.0 };

    it('should update an expense claim', async () => {
      const expected = { id: 'claim-1', amount: 200.0 };
      service.updateClaim.mockResolvedValue(expected);

      const result = await controller.updateClaim(employeeUser, 'claim-1', dto);

      expect(result).toEqual(expected);
      expect(service.updateClaim).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        'claim-1',
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.updateClaim(userNoEmployee, 'claim-1', dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submitClaim', () => {
    it('should submit an expense claim', async () => {
      const expected = { id: 'claim-1', status: 'SUBMITTED' };
      service.submitClaim.mockResolvedValue(expected);

      const result = await controller.submitClaim(employeeUser, 'claim-1');

      expect(result).toEqual(expected);
      expect(service.submitClaim).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        'claim-1',
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.submitClaim(userNoEmployee, 'claim-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteClaim', () => {
    it('should delete an expense claim and return message', async () => {
      service.deleteClaim.mockResolvedValue(undefined);

      const result = await controller.deleteClaim(employeeUser, 'claim-1');

      expect(result).toEqual({ message: 'Expense claim deleted' });
      expect(service.deleteClaim).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        'claim-1',
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.deleteClaim(userNoEmployee, 'claim-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // Approvals (HR / Manager)
  // ============================================
  describe('getPendingApprovals', () => {
    it('should return pending approvals for manager', async () => {
      const expected = { data: [{ id: 'claim-1' }], total: 1 };
      service.getPendingApprovals.mockResolvedValue(expected);
      const query = {};

      const result = await controller.getPendingApprovals(managerUser, query);

      expect(result).toEqual(expected);
      expect(service.getPendingApprovals).toHaveBeenCalledWith(
        managerUser.tenantId,
        managerUser.employeeId,
        managerUser.role,
        query,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.getPendingApprovals(userNoEmployee, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAllClaims', () => {
    it('should return all claims for admin', async () => {
      const expected = { data: [{ id: 'claim-1' }], total: 5 };
      const query = { status: 'APPROVED' };
      service.getAllClaims.mockResolvedValue(expected);

      const result = await controller.getAllClaims(adminUser, query);

      expect(result).toEqual(expected);
      expect(service.getAllClaims).toHaveBeenCalledWith(
        adminUser.tenantId,
        query,
      );
    });
  });

  describe('approveClaim', () => {
    const dto = { approverNote: 'Approved' };

    it('should approve an expense claim', async () => {
      const expected = { id: 'claim-1', status: 'APPROVED' };
      service.approveClaim.mockResolvedValue(expected);

      const result = await controller.approveClaim(managerUser, 'claim-1', dto);

      expect(result).toEqual(expected);
      expect(service.approveClaim).toHaveBeenCalledWith(
        managerUser.tenantId,
        'claim-1',
        managerUser.employeeId,
        managerUser.role,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.approveClaim(userNoEmployee, 'claim-1', dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectClaim', () => {
    const dto = { approverNote: 'Not eligible' };

    it('should reject an expense claim', async () => {
      const expected = { id: 'claim-1', status: 'REJECTED' };
      service.rejectClaim.mockResolvedValue(expected);

      const result = await controller.rejectClaim(managerUser, 'claim-1', dto);

      expect(result).toEqual(expected);
      expect(service.rejectClaim).toHaveBeenCalledWith(
        managerUser.tenantId,
        'claim-1',
        managerUser.employeeId,
        managerUser.role,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.rejectClaim(userNoEmployee, 'claim-1', dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('markReimbursed', () => {
    it('should mark a claim as reimbursed', async () => {
      const expected = { id: 'claim-1', status: 'REIMBURSED' };
      service.markReimbursed.mockResolvedValue(expected);

      const result = await controller.markReimbursed(adminUser, 'claim-1');

      expect(result).toEqual(expected);
      expect(service.markReimbursed).toHaveBeenCalledWith(
        adminUser.tenantId,
        'claim-1',
      );
    });
  });
});
