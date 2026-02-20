import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { SalaryService } from './salary.service';
import { PayrollService } from './payroll.service';
import { PayrollPdfService } from './payroll-pdf.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockSalaryService = {
  getStructures: jest.fn(),
  getStructure: jest.fn(),
  createStructure: jest.fn(),
  updateStructure: jest.fn(),
  deleteStructure: jest.fn(),
  getEmployeeSalary: jest.fn(),
  assignSalary: jest.fn(),
};

const mockPayrollService = {
  getRuns: jest.fn(),
  getRun: jest.fn(),
  createRun: jest.fn(),
  processRun: jest.fn(),
  approveRun: jest.fn(),
  markAsPaid: jest.fn(),
  deleteRun: jest.fn(),
  getPayslipsForRun: jest.fn(),
  getMyPayslips: jest.fn(),
  getPayslip: jest.fn(),
};

describe('PayrollController', () => {
  let controller: PayrollController;
  let salaryService: typeof mockSalaryService;
  let payrollService: typeof mockPayrollService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-admin',
  };

  const employeeUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-2',
  };

  beforeEach(async () => {
    Object.values(mockSalaryService).forEach((fn) => fn.mockReset());
    Object.values(mockPayrollService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PayrollController],
      providers: [
        { provide: SalaryService, useValue: mockSalaryService },
        { provide: PayrollService, useValue: mockPayrollService },
        { provide: PayrollPdfService, useValue: { generatePayslipPdf: jest.fn() } },
      ],
    }).compile();

    controller = module.get<PayrollController>(PayrollController);
    salaryService = module.get(SalaryService);
    payrollService = module.get(PayrollService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // Salary Structures
  // ============================================

  describe('getStructures', () => {
    it('should call salaryService.getStructures with tenantId', async () => {
      const mockResult = [{ id: 'ss-1', name: 'Standard' }];
      salaryService.getStructures.mockResolvedValue(mockResult);

      const result = await controller.getStructures(adminUser);

      expect(salaryService.getStructures).toHaveBeenCalledWith('tenant-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getStructure', () => {
    it('should call salaryService.getStructure with tenantId and id', async () => {
      const mockResult = { id: 'ss-1', name: 'Standard', components: [] };
      salaryService.getStructure.mockResolvedValue(mockResult);

      const result = await controller.getStructure(adminUser, 'ss-1');

      expect(salaryService.getStructure).toHaveBeenCalledWith(
        'tenant-1',
        'ss-1',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('createStructure', () => {
    it('should call salaryService.createStructure with tenantId and dto', async () => {
      const dto = { name: 'Executive', components: [] };
      const mockResult = { id: 'ss-new', ...dto };
      salaryService.createStructure.mockResolvedValue(mockResult);

      const result = await controller.createStructure(adminUser, dto as any);

      expect(salaryService.createStructure).toHaveBeenCalledWith(
        'tenant-1',
        dto,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('updateStructure', () => {
    it('should call salaryService.updateStructure with tenantId, id, and dto', async () => {
      const dto = { name: 'Updated Standard' };
      const mockResult = { id: 'ss-1', name: 'Updated Standard' };
      salaryService.updateStructure.mockResolvedValue(mockResult);

      const result = await controller.updateStructure(
        adminUser,
        'ss-1',
        dto as any,
      );

      expect(salaryService.updateStructure).toHaveBeenCalledWith(
        'tenant-1',
        'ss-1',
        dto,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('deleteStructure', () => {
    it('should call salaryService.deleteStructure and return success message', async () => {
      salaryService.deleteStructure.mockResolvedValue(undefined);

      const result = await controller.deleteStructure(adminUser, 'ss-1');

      expect(salaryService.deleteStructure).toHaveBeenCalledWith(
        'tenant-1',
        'ss-1',
      );
      expect(result).toEqual({ message: 'Salary structure deleted' });
    });
  });

  // ============================================
  // Employee Salary Assignment
  // ============================================

  describe('getEmployeeSalary', () => {
    it('should call salaryService.getEmployeeSalary with tenantId and employeeId', async () => {
      const mockResult = { employeeId: 'emp-2', structureId: 'ss-1' };
      salaryService.getEmployeeSalary.mockResolvedValue(mockResult);

      const result = await controller.getEmployeeSalary(adminUser, 'emp-2');

      expect(salaryService.getEmployeeSalary).toHaveBeenCalledWith(
        'tenant-1',
        'emp-2',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('assignSalary', () => {
    it('should call salaryService.assignSalary with tenantId, employeeId, and dto', async () => {
      const dto = { structureId: 'ss-1', ctc: 1200000 };
      const mockResult = { id: 'sal-1', ...dto };
      salaryService.assignSalary.mockResolvedValue(mockResult);

      const result = await controller.assignSalary(
        adminUser,
        'emp-2',
        dto as any,
      );

      expect(salaryService.assignSalary).toHaveBeenCalledWith(
        'tenant-1',
        'emp-2',
        dto,
      );
      expect(result).toEqual(mockResult);
    });
  });

  // ============================================
  // Payroll Runs
  // ============================================

  describe('getRuns', () => {
    it('should call payrollService.getRuns with tenantId and query', async () => {
      const query = { month: 1, year: 2025 };
      const mockResult = { data: [], total: 0 };
      payrollService.getRuns.mockResolvedValue(mockResult);

      const result = await controller.getRuns(adminUser, query as any);

      expect(payrollService.getRuns).toHaveBeenCalledWith('tenant-1', query);
      expect(result).toEqual(mockResult);
    });
  });

  describe('getRun', () => {
    it('should call payrollService.getRun with tenantId and id', async () => {
      const mockResult = { id: 'pr-1', month: 1, year: 2025, status: 'DRAFT' };
      payrollService.getRun.mockResolvedValue(mockResult);

      const result = await controller.getRun(adminUser, 'pr-1');

      expect(payrollService.getRun).toHaveBeenCalledWith('tenant-1', 'pr-1');
      expect(result).toEqual(mockResult);
    });
  });

  describe('createRun', () => {
    it('should call payrollService.createRun with tenantId and dto', async () => {
      const dto = { month: 2, year: 2025, name: 'Feb 2025' };
      const mockResult = { id: 'pr-new', ...dto, status: 'DRAFT' };
      payrollService.createRun.mockResolvedValue(mockResult);

      const result = await controller.createRun(adminUser, dto as any);

      expect(payrollService.createRun).toHaveBeenCalledWith('tenant-1', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('processRun', () => {
    it('should call payrollService.processRun with tenantId and id', async () => {
      const mockResult = { id: 'pr-1', status: 'PROCESSED' };
      payrollService.processRun.mockResolvedValue(mockResult);

      const result = await controller.processRun(adminUser, 'pr-1');

      expect(payrollService.processRun).toHaveBeenCalledWith(
        'tenant-1',
        'pr-1',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('approveRun', () => {
    it('should call payrollService.approveRun with tenantId and id', async () => {
      const mockResult = { id: 'pr-1', status: 'APPROVED' };
      payrollService.approveRun.mockResolvedValue(mockResult);

      const result = await controller.approveRun(adminUser, 'pr-1');

      expect(payrollService.approveRun).toHaveBeenCalledWith(
        'tenant-1',
        'pr-1',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('markAsPaid', () => {
    it('should call payrollService.markAsPaid with tenantId and id', async () => {
      const mockResult = { id: 'pr-1', status: 'PAID' };
      payrollService.markAsPaid.mockResolvedValue(mockResult);

      const result = await controller.markAsPaid(adminUser, 'pr-1');

      expect(payrollService.markAsPaid).toHaveBeenCalledWith(
        'tenant-1',
        'pr-1',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('deleteRun', () => {
    it('should call payrollService.deleteRun and return success message', async () => {
      payrollService.deleteRun.mockResolvedValue(undefined);

      const result = await controller.deleteRun(adminUser, 'pr-1');

      expect(payrollService.deleteRun).toHaveBeenCalledWith(
        'tenant-1',
        'pr-1',
        UserRole.HR_ADMIN,
      );
      expect(result).toEqual({ message: 'Payroll run deleted' });
    });
  });

  // ============================================
  // Payslips
  // ============================================

  describe('getPayslipsForRun', () => {
    it('should call payrollService.getPayslipsForRun with tenantId, runId, and query', async () => {
      const query = { page: 1, limit: 20 };
      const mockResult = { data: [], total: 0 };
      payrollService.getPayslipsForRun.mockResolvedValue(mockResult);

      const result = await controller.getPayslipsForRun(
        adminUser,
        'pr-1',
        query as any,
      );

      expect(payrollService.getPayslipsForRun).toHaveBeenCalledWith(
        'tenant-1',
        'pr-1',
        query,
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('getMyPayslips', () => {
    it('should call payrollService.getMyPayslips with tenantId and employeeId', async () => {
      const mockResult = [{ id: 'ps-1', month: 1, year: 2025 }];
      payrollService.getMyPayslips.mockResolvedValue(mockResult);

      const result = await controller.getMyPayslips(employeeUser);

      expect(payrollService.getMyPayslips).toHaveBeenCalledWith(
        'tenant-1',
        'emp-2',
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('getPayslip', () => {
    it('should call payrollService.getPayslip and return payslip for admin', async () => {
      const mockPayslip = {
        id: 'ps-1',
        employeeId: 'emp-other',
        grossPay: 50000,
      };
      payrollService.getPayslip.mockResolvedValue(mockPayslip);

      const result = await controller.getPayslip(adminUser, 'ps-1');

      expect(payrollService.getPayslip).toHaveBeenCalledWith(
        'tenant-1',
        'ps-1',
      );
      expect(result).toEqual(mockPayslip);
    });

    it('should allow employee to view their own payslip', async () => {
      const mockPayslip = {
        id: 'ps-1',
        employeeId: 'emp-2',
        grossPay: 50000,
      };
      payrollService.getPayslip.mockResolvedValue(mockPayslip);

      const result = await controller.getPayslip(employeeUser, 'ps-1');

      expect(result).toEqual(mockPayslip);
    });

    it('should throw ForbiddenException if employee tries to view another employees payslip', async () => {
      const mockPayslip = {
        id: 'ps-1',
        employeeId: 'emp-other',
        grossPay: 50000,
      };
      payrollService.getPayslip.mockResolvedValue(mockPayslip);

      await expect(
        controller.getPayslip(employeeUser, 'ps-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow SUPER_ADMIN to view any payslip', async () => {
      const superAdmin: AuthenticatedUser = {
        userId: 'user-sa',
        email: 'sa@test.com',
        tenantId: 'tenant-1',
        role: UserRole.SUPER_ADMIN,
        employeeId: 'emp-sa',
      };
      const mockPayslip = {
        id: 'ps-1',
        employeeId: 'emp-other',
        grossPay: 50000,
      };
      payrollService.getPayslip.mockResolvedValue(mockPayslip);

      const result = await controller.getPayslip(superAdmin, 'ps-1');

      expect(result).toEqual(mockPayslip);
    });
  });
});
