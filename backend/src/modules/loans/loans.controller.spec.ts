import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LoanStatus, LoanType, UserRole } from '@prisma/client';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

const mockService = {
  create: jest.fn(),
  findMy: jest.fn(),
  findAll: jest.fn(),
  findById: jest.fn(),
  cancel: jest.fn(),
  approve: jest.fn(),
  reject: jest.fn(),
  disburse: jest.fn(),
  recordRepayment: jest.fn(),
};

describe('LoansController', () => {
  let controller: LoansController;
  let service: typeof mockService;
  let reflector: Reflector;

  const employeeUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  const managerUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'manager@test.com',
    tenantId: 'tenant-1',
    role: UserRole.MANAGER,
    employeeId: 'emp-mgr-1',
  };

  const hrUser: AuthenticatedUser = {
    userId: 'user-3',
    email: 'hr@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-hr-1',
  };

  const userWithoutEmployee: AuthenticatedUser = {
    userId: 'user-4',
    email: 'orphan@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: undefined,
  };

  const createDto = {
    type: LoanType.LOAN,
    principal: 120000,
    interestRate: 10,
    tenureMonths: 12,
    startMonth: 1,
    startYear: 2026,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LoansController],
      providers: [{ provide: LoansService, useValue: mockService }],
    }).compile();
    controller = module.get<LoansController>(LoansController);
    service = module.get(LoansService);
    reflector = new Reflector();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('passes the caller through as the borrower', async () => {
      service.create.mockResolvedValue({ id: 'loan-1' });

      const result = await controller.create(employeeUser, createDto);

      expect(service.create).toHaveBeenCalledWith(
        'tenant-1',
        'emp-1',
        createDto,
      );
      expect(result).toEqual({ id: 'loan-1' });
    });

    it('refuses a user with no employee profile', async () => {
      await expect(
        controller.create(userWithoutEmployee, createDto),
      ).rejects.toThrow(BadRequestException);
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe('findMy', () => {
    it('scopes to the caller', async () => {
      service.findMy.mockResolvedValue({ data: [], meta: {} });

      await controller.findMy(employeeUser, { page: 1 });

      expect(service.findMy).toHaveBeenCalledWith('tenant-1', 'emp-1', {
        page: 1,
      });
    });

    it('refuses a user with no employee profile', async () => {
      await expect(controller.findMy(userWithoutEmployee, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAll', () => {
    it('hands the role and employee id to the service for scoping', async () => {
      service.findAll.mockResolvedValue({ data: [], meta: {} });

      await controller.findAll(managerUser, { status: LoanStatus.ACTIVE });

      expect(service.findAll).toHaveBeenCalledWith(
        'tenant-1',
        'emp-mgr-1',
        UserRole.MANAGER,
        { status: LoanStatus.ACTIVE },
      );
    });
  });

  describe('findById', () => {
    it('passes the caller identity through for the access check', async () => {
      service.findById.mockResolvedValue({ id: 'loan-1' });

      await controller.findById(employeeUser, 'loan-1');

      expect(service.findById).toHaveBeenCalledWith(
        'tenant-1',
        'loan-1',
        'emp-1',
        UserRole.EMPLOYEE,
      );
    });
  });

  describe('cancel', () => {
    it('cancels on behalf of the caller', async () => {
      service.cancel.mockResolvedValue({ id: 'loan-1' });

      await controller.cancel(employeeUser, 'loan-1');

      expect(service.cancel).toHaveBeenCalledWith(
        'tenant-1',
        'loan-1',
        'emp-1',
      );
    });

    it('refuses a user with no employee profile', async () => {
      await expect(
        controller.cancel(userWithoutEmployee, 'loan-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approve / reject / disburse', () => {
    it('passes the acting user through so the engine can authorize them', async () => {
      service.approve.mockResolvedValue({ id: 'loan-1' });

      await controller.approve(hrUser, 'loan-1');

      expect(service.approve).toHaveBeenCalledWith(hrUser, 'loan-1');
    });

    it('forwards the acting user and the rejection reason', async () => {
      service.reject.mockResolvedValue({ id: 'loan-1' });

      await controller.reject(hrUser, 'loan-1', { reason: 'Too soon' });

      expect(service.reject).toHaveBeenCalledWith(hrUser, 'loan-1', {
        reason: 'Too soon',
      });
    });

    it('disburses', async () => {
      service.disburse.mockResolvedValue({ id: 'loan-1' });

      await controller.disburse(hrUser, 'loan-1');

      expect(service.disburse).toHaveBeenCalledWith('tenant-1', 'loan-1');
    });
  });

  describe('recordRepayment', () => {
    it('forwards the repayment', async () => {
      service.recordRepayment.mockResolvedValue({ id: 'r-1' });
      const dto = { month: 3, year: 2026, amount: 5000 };

      await controller.recordRepayment(hrUser, 'loan-1', dto);

      expect(service.recordRepayment).toHaveBeenCalledWith(
        'tenant-1',
        'loan-1',
        dto,
      );
    });
  });

  // ============================================
  // Role metadata: who the guard will let through
  // ============================================
  describe('role metadata', () => {
    const rolesOn = (method: keyof LoansController) =>
      reflector.get<UserRole[]>(
        ROLES_KEY,
        LoansController.prototype[method] as any,
      );

    it('leaves request, my-list and cancel open to every signed-in role', () => {
      expect(rolesOn('create')).toBeUndefined();
      expect(rolesOn('findMy')).toBeUndefined();
      expect(rolesOn('cancel')).toBeUndefined();
      expect(rolesOn('findById')).toBeUndefined();
    });

    it('lets managers read the queue', () => {
      expect(rolesOn('findAll')).toEqual([
        UserRole.MANAGER,
        UserRole.HR_ADMIN,
        UserRole.SUPER_ADMIN,
      ]);
    });

    it('keeps approve, reject, disburse and repayments with HR only', () => {
      const hrOnly = [UserRole.HR_ADMIN, UserRole.SUPER_ADMIN];
      expect(rolesOn('approve')).toEqual(hrOnly);
      expect(rolesOn('reject')).toEqual(hrOnly);
      expect(rolesOn('disburse')).toEqual(hrOnly);
      expect(rolesOn('recordRepayment')).toEqual(hrOnly);
    });

    it('never lets a manager approve', () => {
      expect(rolesOn('approve')).not.toContain(UserRole.MANAGER);
    });
  });
});
