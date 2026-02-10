import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';

describe('SalaryService', () => {
  let service: SalaryService;
  let prisma: any;

  const tenantId = 'tenant-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalaryService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<SalaryService>(SalaryService);
    prisma = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // getStructures
  // ============================================

  describe('getStructures', () => {
    it('should return all salary structures for a tenant', async () => {
      const mockStructures = [
        { id: 'ss-1', tenantId, name: 'Basic', _count: { employeeSalaries: 3 } },
        { id: 'ss-2', tenantId, name: 'Senior', _count: { employeeSalaries: 1 } },
      ];
      prisma.salaryStructure.findMany.mockResolvedValue(mockStructures);

      const result = await service.getStructures(tenantId);

      expect(prisma.salaryStructure.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { employeeSalaries: true } } },
      });
      expect(result).toEqual(mockStructures);
    });

    it('should return an empty array when no structures exist', async () => {
      prisma.salaryStructure.findMany.mockResolvedValue([]);

      const result = await service.getStructures(tenantId);

      expect(result).toEqual([]);
    });
  });

  // ============================================
  // getStructure
  // ============================================

  describe('getStructure', () => {
    it('should return a single structure with active employee salaries', async () => {
      const mockStructure = {
        id: 'ss-1',
        tenantId,
        name: 'Basic',
        employeeSalaries: [
          { id: 'es-1', employee: { id: 'emp-1', firstName: 'John' } },
        ],
      };
      prisma.salaryStructure.findFirst.mockResolvedValue(mockStructure);

      const result = await service.getStructure(tenantId, 'ss-1');

      expect(prisma.salaryStructure.findFirst).toHaveBeenCalledWith({
        where: { id: 'ss-1', tenantId },
        include: {
          employeeSalaries: {
            where: { isActive: true },
            include: {
              employee: {
                select: {
                  id: true,
                  employeeCode: true,
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
        },
      });
      expect(result).toEqual(mockStructure);
    });

    it('should throw NotFoundException when structure not found', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(null);

      await expect(service.getStructure(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================================
  // createStructure
  // ============================================

  describe('createStructure', () => {
    const dto = {
      name: 'Standard',
      description: 'Standard package',
      components: [
        { name: 'HRA', type: 'earning' as const, calcType: 'percentage' as const, value: 40 },
        { name: 'PF', type: 'deduction' as const, calcType: 'percentage' as const, value: 12 },
      ],
    };

    it('should create a new salary structure', async () => {
      prisma.salaryStructure.findUnique.mockResolvedValue(null);
      const mockCreated = { id: 'ss-1', tenantId, ...dto };
      prisma.salaryStructure.create.mockResolvedValue(mockCreated);

      const result = await service.createStructure(tenantId, dto);

      expect(prisma.salaryStructure.findUnique).toHaveBeenCalledWith({
        where: { tenantId_name: { tenantId, name: 'Standard' } },
      });
      expect(prisma.salaryStructure.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          name: 'Standard',
          description: 'Standard package',
          components: dto.components as any,
        },
      });
      expect(result).toEqual(mockCreated);
    });

    it('should throw ConflictException when structure name already exists', async () => {
      prisma.salaryStructure.findUnique.mockResolvedValue({
        id: 'existing',
        name: 'Standard',
      });

      await expect(service.createStructure(tenantId, dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ============================================
  // updateStructure
  // ============================================

  describe('updateStructure', () => {
    const structureId = 'ss-1';
    const existing = {
      id: structureId,
      tenantId,
      name: 'Standard',
      description: 'Old desc',
      isActive: true,
    };

    it('should update a structure with new name, description, components, isActive', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(existing);
      prisma.salaryStructure.findUnique.mockResolvedValue(null); // no name conflict
      const updated = { ...existing, name: 'Premium', description: 'Updated desc' };
      prisma.salaryStructure.update.mockResolvedValue(updated);

      const dto = {
        name: 'Premium',
        description: 'Updated desc',
        components: [{ name: 'HRA', type: 'earning' as const, calcType: 'fixed' as const, value: 5000 }],
        isActive: true,
      };

      const result = await service.updateStructure(tenantId, structureId, dto);

      expect(prisma.salaryStructure.findFirst).toHaveBeenCalledWith({
        where: { id: structureId, tenantId },
      });
      expect(prisma.salaryStructure.findUnique).toHaveBeenCalledWith({
        where: { tenantId_name: { tenantId, name: 'Premium' } },
      });
      expect(prisma.salaryStructure.update).toHaveBeenCalledWith({
        where: { id: structureId },
        data: {
          name: 'Premium',
          description: 'Updated desc',
          components: dto.components as any,
          isActive: true,
        },
      });
      expect(result).toEqual(updated);
    });

    it('should skip name uniqueness check when name is unchanged', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(existing);
      prisma.salaryStructure.update.mockResolvedValue(existing);

      await service.updateStructure(tenantId, structureId, {
        name: 'Standard', // same name
        description: 'New desc',
      });

      expect(prisma.salaryStructure.findUnique).not.toHaveBeenCalled();
    });

    it('should skip name uniqueness check when name is not provided', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(existing);
      prisma.salaryStructure.update.mockResolvedValue(existing);

      await service.updateStructure(tenantId, structureId, {
        description: 'New desc',
      });

      expect(prisma.salaryStructure.findUnique).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when structure not found', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStructure(tenantId, structureId, { name: 'New' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when new name conflicts with existing structure', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(existing);
      prisma.salaryStructure.findUnique.mockResolvedValue({
        id: 'other-ss',
        name: 'Premium',
      });

      await expect(
        service.updateStructure(tenantId, structureId, { name: 'Premium' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ============================================
  // deleteStructure
  // ============================================

  describe('deleteStructure', () => {
    it('should delete a structure with zero assigned employees', async () => {
      const structure = {
        id: 'ss-1',
        tenantId,
        _count: { employeeSalaries: 0 },
      };
      prisma.salaryStructure.findFirst.mockResolvedValue(structure);
      prisma.salaryStructure.delete.mockResolvedValue({});

      await service.deleteStructure(tenantId, 'ss-1');

      expect(prisma.salaryStructure.findFirst).toHaveBeenCalledWith({
        where: { id: 'ss-1', tenantId },
        include: { _count: { select: { employeeSalaries: true } } },
      });
      expect(prisma.salaryStructure.delete).toHaveBeenCalledWith({
        where: { id: 'ss-1' },
      });
    });

    it('should throw NotFoundException when structure not found', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue(null);

      await expect(service.deleteStructure(tenantId, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when structure has assigned employees', async () => {
      prisma.salaryStructure.findFirst.mockResolvedValue({
        id: 'ss-1',
        tenantId,
        _count: { employeeSalaries: 5 },
      });

      await expect(service.deleteStructure(tenantId, 'ss-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ============================================
  // getEmployeeSalary
  // ============================================

  describe('getEmployeeSalary', () => {
    it('should return salary records for an employee ordered by effectiveFrom desc', async () => {
      const mockSalaries = [
        { id: 'es-1', employeeId: 'emp-1', basePay: 60000, salaryStructure: { id: 'ss-1', name: 'Senior' } },
        { id: 'es-2', employeeId: 'emp-1', basePay: 50000, salaryStructure: { id: 'ss-2', name: 'Basic' } },
      ];
      prisma.employeeSalary.findMany.mockResolvedValue(mockSalaries);

      const result = await service.getEmployeeSalary(tenantId, 'emp-1');

      expect(prisma.employeeSalary.findMany).toHaveBeenCalledWith({
        where: { tenantId, employeeId: 'emp-1' },
        include: {
          salaryStructure: { select: { id: true, name: true, components: true } },
        },
        orderBy: { effectiveFrom: 'desc' },
      });
      expect(result).toEqual(mockSalaries);
    });
  });

  // ============================================
  // assignSalary
  // ============================================

  describe('assignSalary', () => {
    const employeeId = 'emp-1';
    const dto = {
      salaryStructureId: 'ss-1',
      basePay: 60000,
      effectiveFrom: '2026-02-01',
      effectiveTo: '2026-12-31',
    };

    it('should assign salary to an employee and deactivate previous salary', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: employeeId, tenantId });
      prisma.salaryStructure.findFirst.mockResolvedValue({
        id: 'ss-1',
        tenantId,
        isActive: true,
      });
      prisma.employeeSalary.updateMany.mockResolvedValue({ count: 1 });
      const mockCreated = {
        id: 'es-new',
        tenantId,
        employeeId,
        ...dto,
        salaryStructure: { id: 'ss-1', name: 'Standard' },
      };
      prisma.employeeSalary.create.mockResolvedValue(mockCreated);

      const result = await service.assignSalary(tenantId, employeeId, dto);

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: employeeId, tenantId },
      });
      expect(prisma.salaryStructure.findFirst).toHaveBeenCalledWith({
        where: { id: 'ss-1', tenantId, isActive: true },
      });
      expect(prisma.employeeSalary.updateMany).toHaveBeenCalledWith({
        where: { tenantId, employeeId, isActive: true },
        data: {
          isActive: false,
          effectiveTo: new Date('2026-02-01'),
        },
      });
      expect(prisma.employeeSalary.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          employeeId,
          salaryStructureId: 'ss-1',
          basePay: 60000,
          effectiveFrom: new Date('2026-02-01'),
          effectiveTo: new Date('2026-12-31'),
        },
        include: {
          salaryStructure: { select: { id: true, name: true } },
        },
      });
      expect(result).toEqual(mockCreated);
    });

    it('should handle null effectiveTo', async () => {
      const dtoNoEnd = {
        salaryStructureId: 'ss-1',
        basePay: 60000,
        effectiveFrom: '2026-02-01',
      };
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', tenantId });
      prisma.salaryStructure.findFirst.mockResolvedValue({ id: 'ss-1', tenantId, isActive: true });
      prisma.employeeSalary.updateMany.mockResolvedValue({ count: 0 });
      prisma.employeeSalary.create.mockResolvedValue({ id: 'es-new' });

      await service.assignSalary(tenantId, 'emp-1', dtoNoEnd);

      expect(prisma.employeeSalary.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            effectiveTo: null,
          }),
        }),
      );
    });

    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.assignSalary(tenantId, 'nonexistent', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when salary structure not found or inactive', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-1', tenantId });
      prisma.salaryStructure.findFirst.mockResolvedValue(null);

      await expect(
        service.assignSalary(tenantId, 'emp-1', dto),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
