import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

@Injectable()
export class DepartmentsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Create a new department
   */
  async create(tenantId: string, dto: CreateDepartmentDto) {
    // Check if department code already exists
    const existing = await this.prisma.department.findUnique({
      where: {
        tenantId_code: {
          tenantId,
          code: dto.code,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Department code already exists');
    }

    // Validate parent department if provided
    if (dto.parentId) {
      const parent = await this.prisma.department.findFirst({
        where: { id: dto.parentId, tenantId },
      });

      if (!parent) {
        throw new NotFoundException('Parent department not found');
      }
    }

    return this.prisma.department.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        parentId: dto.parentId,
        description: dto.description,
      },
      include: {
        parent: true,
        children: true,
        _count: {
          select: { employees: true },
        },
      },
    });
  }

  /**
   * Get all departments
   */
  async findAll(tenantId: string) {
    return this.prisma.department.findMany({
      where: { tenantId },
      include: {
        parent: true,
        children: true,
        _count: {
          select: { employees: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Get department hierarchy (tree structure)
   */
  async getHierarchy(tenantId: string) {
    const departments = await this.prisma.department.findMany({
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
        _count: {
          select: { employees: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return departments;
  }

  /**
   * Get department by ID
   */
  async findOne(tenantId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, tenantId },
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
        _count: {
          select: { employees: true },
        },
      },
    });

    if (!department) {
      throw new NotFoundException('Department not found');
    }

    return department;
  }

  /**
   * Update department
   */
  async update(tenantId: string, id: string, dto: UpdateDepartmentDto) {
    await this.findOne(tenantId, id);

    // Check for code conflict if updating code
    if (dto.code) {
      const existing = await this.prisma.department.findFirst({
        where: {
          tenantId,
          code: dto.code,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException('Department code already exists');
      }
    }

    // Validate parent department if provided
    if (dto.parentId) {
      if (dto.parentId === id) {
        throw new ConflictException('Department cannot be its own parent');
      }

      const parent = await this.prisma.department.findFirst({
        where: { id: dto.parentId, tenantId },
      });

      if (!parent) {
        throw new NotFoundException('Parent department not found');
      }
    }

    return this.prisma.department.update({
      where: { id },
      data: dto,
      include: {
        parent: true,
        children: true,
        _count: {
          select: { employees: true },
        },
      },
    });
  }

  /**
   * Delete department
   */
  async remove(tenantId: string, id: string) {
    const department = await this.findOne(tenantId, id);

    // Check if department has employees
    if (department.employees.length > 0) {
      throw new ConflictException(
        'Cannot delete department with employees. Reassign employees first.',
      );
    }

    // Check if department has children
    if (department.children.length > 0) {
      throw new ConflictException(
        'Cannot delete department with sub-departments. Delete or reassign them first.',
      );
    }

    return this.prisma.department.delete({
      where: { id },
    });
  }
}
