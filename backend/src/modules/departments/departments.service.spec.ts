import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { DepartmentsService } from './departments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { createMockPrismaService } from '../../test/helpers';

describe('DepartmentsService', () => {
  let service: DepartmentsService;
  let prisma: any;

  const tenantId = 'test-tenant';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<DepartmentsService>(DepartmentsService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Shared fixtures
  // ---------------------------------------------------------------------------

  const mockDepartment = {
    id: 'dept-1',
    tenantId,
    name: 'Engineering',
    code: 'ENG',
    parentId: null,
    description: 'Engineering department',
    parent: null,
    children: [],
    employees: [],
    _count: { employees: 5 },
  };

  const mockChildDepartment = {
    id: 'dept-2',
    tenantId,
    name: 'Frontend',
    code: 'FE',
    parentId: 'dept-1',
    description: 'Frontend team',
    parent: { id: 'dept-1', name: 'Engineering' },
    children: [],
    employees: [],
    _count: { employees: 3 },
  };

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    const createDto = {
      name: 'Engineering',
      code: 'ENG',
      description: 'Engineering department',
    };

    it('should create a department successfully', async () => {
      prisma.department.findUnique.mockResolvedValue(null);
      prisma.department.create.mockResolvedValue(mockDepartment);

      const result = await service.create(tenantId, createDto);

      expect(result).toEqual(mockDepartment);
      expect(prisma.department.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_code: {
            tenantId,
            code: 'ENG',
          },
        },
      });
      expect(prisma.department.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          name: 'Engineering',
          code: 'ENG',
          parentId: undefined,
          description: 'Engineering department',
        },
        include: {
          parent: true,
          children: true,
          _count: { select: { employees: true } },
        },
      });
    });

    it('should create a child department with valid parentId', async () => {
      const childDto = {
        name: 'Frontend',
        code: 'FE',
        parentId: 'dept-1',
        description: 'Frontend team',
      };

      prisma.department.findUnique.mockResolvedValue(null);
      prisma.department.findFirst.mockResolvedValue(mockDepartment); // parent exists
      prisma.department.create.mockResolvedValue(mockChildDepartment);

      const result = await service.create(tenantId, childDto);

      expect(result).toEqual(mockChildDepartment);
      expect(prisma.department.findFirst).toHaveBeenCalledWith({
        where: { id: 'dept-1', tenantId },
      });
    });

    it('should throw ConflictException when department code already exists', async () => {
      prisma.department.findUnique.mockResolvedValue(mockDepartment);

      await expect(service.create(tenantId, createDto)).rejects.toThrow(ConflictException);
      await expect(service.create(tenantId, createDto)).rejects.toThrow(
        'Department code already exists',
      );
    });

    it('should throw NotFoundException when parent department does not exist', async () => {
      const childDto = {
        name: 'Frontend',
        code: 'FE',
        parentId: 'non-existent',
      };

      prisma.department.findUnique.mockResolvedValue(null); // code check passes
      prisma.department.findFirst.mockResolvedValue(null); // parent not found

      await expect(service.create(tenantId, childDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(tenantId, childDto)).rejects.toThrow(
        'Parent department not found',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------

  describe('findAll', () => {
    it('should return all departments for the tenant', async () => {
      const mockDepartments = [mockDepartment, mockChildDepartment];
      prisma.department.findMany.mockResolvedValue(mockDepartments);

      const result = await service.findAll(tenantId);

      expect(result).toEqual(mockDepartments);
      expect(prisma.department.findMany).toHaveBeenCalledWith({
        where: { tenantId },
        include: {
          parent: true,
          children: true,
          _count: { select: { employees: true } },
        },
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty array when no departments exist', async () => {
      prisma.department.findMany.mockResolvedValue([]);

      const result = await service.findAll(tenantId);

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // getHierarchy
  // ---------------------------------------------------------------------------

  describe('getHierarchy', () => {
    it('should return root departments with nested children', async () => {
      const hierarchyResult = [
        {
          ...mockDepartment,
          children: [
            {
              ...mockChildDepartment,
              children: [],
            },
          ],
        },
      ];

      prisma.department.findMany.mockResolvedValue(hierarchyResult);

      const result = await service.getHierarchy(tenantId);

      expect(result).toEqual(hierarchyResult);
      expect(prisma.department.findMany).toHaveBeenCalledWith({
        where: { tenantId, parentId: null },
        include: {
          children: {
            include: {
              children: {
                include: {
                  children: true,
                },
              },
            },
          },
          _count: { select: { employees: true } },
        },
        orderBy: { name: 'asc' },
      });
    });

    it('should return empty array when no root departments exist', async () => {
      prisma.department.findMany.mockResolvedValue([]);

      const result = await service.getHierarchy(tenantId);

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------------------

  describe('findOne', () => {
    it('should return department by id', async () => {
      prisma.department.findFirst.mockResolvedValue(mockDepartment);

      const result = await service.findOne(tenantId, 'dept-1');

      expect(result).toEqual(mockDepartment);
      expect(prisma.department.findFirst).toHaveBeenCalledWith({
        where: { id: 'dept-1', tenantId },
        include: {
          parent: true,
          children: true,
          employees: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              designation: true,
              status: true,
            },
          },
          _count: { select: { employees: true } },
        },
      });
    });

    it('should throw NotFoundException when department does not exist', async () => {
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(service.findOne(tenantId, 'non-existent')).rejects.toThrow(NotFoundException);
      await expect(service.findOne(tenantId, 'non-existent')).rejects.toThrow(
        'Department not found',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe('update', () => {
    const updateDto = { name: 'Engineering v2', code: 'ENG2' };

    const updatedDepartment = {
      ...mockDepartment,
      name: 'Engineering v2',
      code: 'ENG2',
    };

    it('should update department successfully', async () => {
      prisma.department.findFirst
        .mockResolvedValueOnce(mockDepartment) // findOne check
        .mockResolvedValueOnce(null); // code conflict check
      prisma.department.update.mockResolvedValue(updatedDepartment);

      const result = await service.update(tenantId, 'dept-1', updateDto);

      expect(result).toEqual(updatedDepartment);
      expect(prisma.department.update).toHaveBeenCalledWith({
        where: { id: 'dept-1' },
        data: updateDto,
        include: {
          parent: true,
          children: true,
          _count: { select: { employees: true } },
        },
      });
    });

    it('should throw NotFoundException when department does not exist', async () => {
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(service.update(tenantId, 'non-existent', updateDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when code conflicts with another department', async () => {
      prisma.department.findFirst
        .mockResolvedValueOnce(mockDepartment) // findOne passes
        .mockResolvedValueOnce({ id: 'dept-other', code: 'ENG2' }); // code conflict

      await expect(service.update(tenantId, 'dept-1', updateDto)).rejects.toThrow(
        'Department code already exists',
      );
    });

    it('should skip code conflict check when code is not in dto', async () => {
      const nameOnlyDto = { name: 'Engineering v2' };
      prisma.department.findFirst.mockResolvedValue(mockDepartment);
      prisma.department.update.mockResolvedValue({ ...mockDepartment, name: 'Engineering v2' });

      await service.update(tenantId, 'dept-1', nameOnlyDto);

      // findFirst called only once (findOne), not for code conflict
      expect(prisma.department.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException when setting department as its own parent', async () => {
      const selfParentDto = { parentId: 'dept-1' };
      prisma.department.findFirst.mockResolvedValue(mockDepartment);

      await expect(service.update(tenantId, 'dept-1', selfParentDto)).rejects.toThrow(
        'Department cannot be its own parent',
      );
    });

    it('should throw NotFoundException when parent department does not exist', async () => {
      const parentDto = { parentId: 'non-existent-parent' };
      prisma.department.findFirst
        .mockResolvedValueOnce(mockDepartment) // findOne passes
        .mockResolvedValueOnce(null); // parent not found

      await expect(service.update(tenantId, 'dept-1', parentDto)).rejects.toThrow(
        'Parent department not found',
      );
    });

    it('should validate parent when parentId is provided along with code', async () => {
      const dtoWithCodeAndParent = { code: 'ENG2', parentId: 'dept-other' };
      const parentDept = { id: 'dept-other', tenantId, name: 'Operations' };

      prisma.department.findFirst
        .mockResolvedValueOnce(mockDepartment) // findOne passes
        .mockResolvedValueOnce(null) // code conflict check passes
        .mockResolvedValueOnce(parentDept); // parent validation passes
      prisma.department.update.mockResolvedValue(updatedDepartment);

      await service.update(tenantId, 'dept-1', dtoWithCodeAndParent);

      // findFirst called 3 times: findOne, code conflict, parent validation
      expect(prisma.department.findFirst).toHaveBeenCalledTimes(3);
    });
  });

  // ---------------------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------------------

  describe('remove', () => {
    it('should delete department when it has no employees and no children', async () => {
      const emptyDepartment = {
        ...mockDepartment,
        employees: [],
        children: [],
      };

      prisma.department.findFirst.mockResolvedValue(emptyDepartment);
      prisma.department.delete.mockResolvedValue(emptyDepartment);

      const result = await service.remove(tenantId, 'dept-1');

      expect(result).toEqual(emptyDepartment);
      expect(prisma.department.delete).toHaveBeenCalledWith({
        where: { id: 'dept-1' },
      });
    });

    it('should throw NotFoundException when department does not exist', async () => {
      prisma.department.findFirst.mockResolvedValue(null);

      await expect(service.remove(tenantId, 'non-existent')).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when department has employees', async () => {
      const deptWithEmployees = {
        ...mockDepartment,
        employees: [{ id: 'emp-1', firstName: 'John' }],
        children: [],
      };

      prisma.department.findFirst.mockResolvedValue(deptWithEmployees);

      await expect(service.remove(tenantId, 'dept-1')).rejects.toThrow(ConflictException);
      await expect(service.remove(tenantId, 'dept-1')).rejects.toThrow(
        'Cannot delete department with employees. Reassign employees first.',
      );
    });

    it('should throw ConflictException when department has children', async () => {
      const deptWithChildren = {
        ...mockDepartment,
        employees: [],
        children: [{ id: 'dept-child', name: 'Sub-dept' }],
      };

      prisma.department.findFirst.mockResolvedValue(deptWithChildren);

      await expect(service.remove(tenantId, 'dept-1')).rejects.toThrow(ConflictException);
      await expect(service.remove(tenantId, 'dept-1')).rejects.toThrow(
        'Cannot delete department with sub-departments. Delete or reassign them first.',
      );
    });
  });
});
