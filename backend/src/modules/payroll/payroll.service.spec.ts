import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PayrollCalculationService } from './payroll-calculation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';
import { PayrollRunStatus } from '@prisma/client';

describe('PayrollService', () => {
  let service: PayrollService;
  let prisma: any;
  let calculationService: any;

  const tenantId = 'tenant-1';

  beforeEach(async () => {
    const mockCalculationService = {
      calculateForEmployee: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: PayrollCalculationService, useValue: mockCalculationService },
      ],
    }).compile();

    service = module.get<PayrollService>(PayrollService);
    prisma = module.get(PrismaService);
    calculationService = module.get(PayrollCalculationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // getRuns
  // ============================================

  describe('getRuns', () => {
    it('should return all runs for a tenant with no filters', async () => {
      const mockRuns = [
        { id: 'run-1', tenantId, month: 1, year: 2026, status: 'DRAFT' },
      ];
      prisma.payrollRun.findMany.mockResolvedValue(mockRuns);

      const result = await service.getRuns(tenantId, {});

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        include: { _count: { select: { payslips: true } } },
      });
      expect(result).toEqual(mockRuns);
    });

    it('should filter by year when provided', async () => {
      prisma.payrollRun.findMany.mockResolvedValue([]);

      await service.getRuns(tenantId, { year: '2026' });

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, year: 2026 },
        }),
      );
    });

    it('should filter by status when provided', async () => {
      prisma.payrollRun.findMany.mockResolvedValue([]);

      await service.getRuns(tenantId, { status: 'DRAFT' });

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, status: 'DRAFT' },
        }),
      );
    });

    it('should filter by both year and status when provided', async () => {
      prisma.payrollRun.findMany.mockResolvedValue([]);

      await service.getRuns(tenantId, { year: '2026', status: 'COMPUTED' });

      expect(prisma.payrollRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, year: 2026, status: 'COMPUTED' },
        }),
      );
    });
  });

  // ============================================
  // getRun
  // ============================================

  describe('getRun', () => {
    it('should return a run with payslips by id', async () => {
      const mockRun = {
        id: 'run-1',
        tenantId,
        month: 1,
        year: 2026,
        payslips: [],
      };
      prisma.payrollRun.findFirst.mockResolvedValue(mockRun);

      const result = await service.getRun(tenantId, 'run-1');

      expect(prisma.payrollRun.findFirst).toHaveBeenCalledWith({
        where: { id: 'run-1', tenantId },
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
      expect(result).toEqual(mockRun);
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.getRun(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================
  // createRun
  // ============================================

  describe('createRun', () => {
    const dto = { month: 1, year: 2026, remarks: 'Jan payroll' };

    it('should create a new payroll run', async () => {
      const mockCreated = { id: 'run-1', tenantId, ...dto, status: 'DRAFT' };
      prisma.payrollRun.findUnique.mockResolvedValue(null);
      prisma.payrollRun.create.mockResolvedValue(mockCreated);

      const result = await service.createRun(tenantId, dto);

      expect(prisma.payrollRun.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_month_year: { tenantId, month: 1, year: 2026 },
        },
      });
      expect(prisma.payrollRun.create).toHaveBeenCalledWith({
        data: { tenantId, month: 1, year: 2026, remarks: 'Jan payroll' },
      });
      expect(result).toEqual(mockCreated);
    });

    it('should throw ConflictException when duplicate run exists', async () => {
      prisma.payrollRun.findUnique.mockResolvedValue({
        id: 'existing-run',
        tenantId,
        month: 1,
        year: 2026,
      });

      await expect(service.createRun(tenantId, dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ============================================
  // processRun
  // ============================================

  describe('processRun', () => {
    const runId = 'run-1';
    const draftRun = {
      id: runId,
      tenantId,
      month: 1,
      year: 2026,
      status: PayrollRunStatus.DRAFT,
    };

    it('should process a DRAFT run and create payslips', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(draftRun);
      prisma.payrollRun.update.mockResolvedValue({});
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1' },
        { id: 'emp-2' },
      ]);
      prisma.payslip.deleteMany.mockResolvedValue({});
      prisma.payslip.create.mockResolvedValue({});

      const calcResult = {
        employeeId: 'emp-1',
        workingDays: 22,
        presentDays: 20,
        leaveDays: 2,
        lopDays: 0,
        otHours: 5,
        basePay: 50000,
        earnings: [{ name: 'HRA', amount: 10000 }],
        deductions: [{ name: 'PF', amount: 5000 }],
        grossPay: 60000,
        totalDeductions: 5000,
        netPay: 55000,
        otPay: 1000,
      };

      calculationService.calculateForEmployee
        .mockResolvedValueOnce(calcResult)
        .mockResolvedValueOnce(null); // second employee has no salary

      const updatedRun = { id: runId, status: 'COMPUTED', processedCount: 1 };
      // The last update call returns the final result
      prisma.payrollRun.update
        .mockResolvedValueOnce({}) // PROCESSING update
        .mockResolvedValueOnce(updatedRun); // COMPUTED update

      const result = await service.processRun(tenantId, runId);

      expect(prisma.payrollRun.update).toHaveBeenCalledWith({
        where: { id: runId },
        data: { status: PayrollRunStatus.PROCESSING },
      });
      expect(prisma.payslip.deleteMany).toHaveBeenCalledWith({
        where: { payrollRunId: runId },
      });
      expect(calculationService.calculateForEmployee).toHaveBeenCalledTimes(2);
      expect(prisma.payslip.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updatedRun);
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.processRun(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when run is not DRAFT', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        ...draftRun,
        status: PayrollRunStatus.COMPUTED,
      });

      await expect(service.processRun(tenantId, runId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should revert to DRAFT status on processing error', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(draftRun);
      prisma.payrollRun.update.mockResolvedValue({});
      prisma.employee.findMany.mockRejectedValue(new Error('DB error'));

      await expect(service.processRun(tenantId, runId)).rejects.toThrow('DB error');

      // First call = PROCESSING, second call = revert to DRAFT
      expect(prisma.payrollRun.update).toHaveBeenCalledTimes(2);
      expect(prisma.payrollRun.update).toHaveBeenLastCalledWith({
        where: { id: runId },
        data: { status: PayrollRunStatus.DRAFT },
      });
    });
  });

  // ============================================
  // approveRun
  // ============================================

  describe('approveRun', () => {
    it('should approve a COMPUTED run', async () => {
      const run = {
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.COMPUTED,
      };
      prisma.payrollRun.findFirst.mockResolvedValue(run);
      const approved = { ...run, status: PayrollRunStatus.APPROVED };
      prisma.payrollRun.update.mockResolvedValue(approved);

      const result = await service.approveRun(tenantId, 'run-1');

      expect(prisma.payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: {
          status: PayrollRunStatus.APPROVED,
          approvedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(approved);
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.approveRun(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when run is not COMPUTED', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.DRAFT,
      });

      await expect(service.approveRun(tenantId, 'run-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // markAsPaid
  // ============================================

  describe('markAsPaid', () => {
    it('should mark an APPROVED run as PAID', async () => {
      const run = {
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.APPROVED,
      };
      prisma.payrollRun.findFirst.mockResolvedValue(run);
      const paid = { ...run, status: PayrollRunStatus.PAID };
      prisma.payrollRun.update.mockResolvedValue(paid);

      const result = await service.markAsPaid(tenantId, 'run-1');

      expect(prisma.payrollRun.update).toHaveBeenCalledWith({
        where: { id: 'run-1' },
        data: { status: PayrollRunStatus.PAID },
      });
      expect(result).toEqual(paid);
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.markAsPaid(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when run is not APPROVED', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.COMPUTED,
      });

      await expect(service.markAsPaid(tenantId, 'run-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // deleteRun
  // ============================================

  describe('deleteRun', () => {
    it('should delete a DRAFT run and its payslips', async () => {
      const run = {
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.DRAFT,
      };
      prisma.payrollRun.findFirst.mockResolvedValue(run);
      prisma.payslip.deleteMany.mockResolvedValue({});
      prisma.payrollRun.delete.mockResolvedValue({});

      await service.deleteRun(tenantId, 'run-1');

      expect(prisma.payslip.deleteMany).toHaveBeenCalledWith({
        where: { payrollRunId: 'run-1' },
      });
      expect(prisma.payrollRun.delete).toHaveBeenCalledWith({
        where: { id: 'run-1' },
      });
    });

    it('should throw NotFoundException when run not found', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue(null);

      await expect(service.deleteRun(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when run is not DRAFT', async () => {
      prisma.payrollRun.findFirst.mockResolvedValue({
        id: 'run-1',
        tenantId,
        status: PayrollRunStatus.APPROVED,
      });

      await expect(service.deleteRun(tenantId, 'run-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // getPayslipsForRun
  // ============================================

  describe('getPayslipsForRun', () => {
    it('should return paginated payslips with default page/limit', async () => {
      const mockPayslips = [{ id: 'slip-1', payrollRunId: 'run-1' }];
      prisma.payslip.findMany.mockResolvedValue(mockPayslips);
      prisma.payslip.count.mockResolvedValue(1);

      const result = await service.getPayslipsForRun(tenantId, 'run-1', {});

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, payrollRunId: 'run-1' },
          skip: 0,
          take: 50,
        }),
      );
      expect(result).toEqual({
        data: mockPayslips,
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      });
    });

    it('should respect custom page and limit values', async () => {
      prisma.payslip.findMany.mockResolvedValue([]);
      prisma.payslip.count.mockResolvedValue(100);

      const result = await service.getPayslipsForRun(tenantId, 'run-1', {
        page: '2',
        limit: '10',
      });

      expect(prisma.payslip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
      expect(result.meta).toEqual({
        total: 100,
        page: 2,
        limit: 10,
        totalPages: 10,
      });
    });
  });

  // ============================================
  // getMyPayslips
  // ============================================

  describe('getMyPayslips', () => {
    it('should return payslips for the employee from APPROVED/PAID runs', async () => {
      const mockPayslips = [
        { id: 'slip-1', employeeId: 'emp-1', payrollRun: { month: 1, year: 2026, status: 'PAID' } },
      ];
      prisma.payslip.findMany.mockResolvedValue(mockPayslips);

      const result = await service.getMyPayslips(tenantId, 'emp-1');

      expect(prisma.payslip.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          employeeId: 'emp-1',
          payrollRun: {
            status: { in: [PayrollRunStatus.APPROVED, PayrollRunStatus.PAID] },
          },
        },
        include: {
          payrollRun: { select: { month: true, year: true, status: true } },
        },
        orderBy: [
          { payrollRun: { year: 'desc' } },
          { payrollRun: { month: 'desc' } },
        ],
      });
      expect(result).toEqual(mockPayslips);
    });

    it('should throw BadRequestException when employeeId is falsy', async () => {
      await expect(service.getMyPayslips(tenantId, '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // getPayslip
  // ============================================

  describe('getPayslip', () => {
    it('should return a payslip with employee and run details', async () => {
      const mockPayslip = {
        id: 'slip-1',
        tenantId,
        employee: { id: 'emp-1', firstName: 'John', lastName: 'Doe' },
        payrollRun: { month: 1, year: 2026, status: 'PAID' },
      };
      prisma.payslip.findFirst.mockResolvedValue(mockPayslip);

      const result = await service.getPayslip(tenantId, 'slip-1');

      expect(prisma.payslip.findFirst).toHaveBeenCalledWith({
        where: { id: 'slip-1', tenantId },
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
      expect(result).toEqual(mockPayslip);
    });

    it('should throw NotFoundException when payslip not found', async () => {
      prisma.payslip.findFirst.mockResolvedValue(null);

      await expect(service.getPayslip(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
