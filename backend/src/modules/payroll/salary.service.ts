import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateSalaryStructureDto,
  UpdateSalaryStructureDto,
  AssignSalaryDto,
} from './dto/payroll.dto';

@Injectable()
export class SalaryService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // Salary Structures
  // ============================================

  async getStructures(tenantId: string) {
    return this.prisma.salaryStructure.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { employeeSalaries: true } },
      },
    });
  }

  async getStructure(tenantId: string, id: string) {
    const structure = await this.prisma.salaryStructure.findFirst({
      where: { id, tenantId },
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
    if (!structure) throw new NotFoundException('Salary structure not found');
    return structure;
  }

  async createStructure(tenantId: string, dto: CreateSalaryStructureDto) {
    const existing = await this.prisma.salaryStructure.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });
    if (existing)
      throw new ConflictException(
        `Salary structure "${dto.name}" already exists`,
      );

    return this.prisma.salaryStructure.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        components: dto.components as any,
      },
    });
  }

  async updateStructure(
    tenantId: string,
    id: string,
    dto: UpdateSalaryStructureDto,
  ) {
    const structure = await this.prisma.salaryStructure.findFirst({
      where: { id, tenantId },
    });
    if (!structure) throw new NotFoundException('Salary structure not found');

    if (dto.name && dto.name !== structure.name) {
      const existing = await this.prisma.salaryStructure.findUnique({
        where: { tenantId_name: { tenantId, name: dto.name } },
      });
      if (existing)
        throw new ConflictException(
          `Salary structure "${dto.name}" already exists`,
        );
    }

    return this.prisma.salaryStructure.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.components !== undefined && {
          components: dto.components as any,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteStructure(tenantId: string, id: string) {
    const structure = await this.prisma.salaryStructure.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { employeeSalaries: true } } },
    });
    if (!structure) throw new NotFoundException('Salary structure not found');
    if (structure._count.employeeSalaries > 0) {
      throw new ConflictException(
        'Cannot delete structure with assigned employees. Deactivate instead.',
      );
    }

    await this.prisma.salaryStructure.delete({ where: { id } });
  }

  // ============================================
  // Employee Salary Assignment
  // ============================================

  async getEmployeeSalary(tenantId: string, employeeId: string) {
    return this.prisma.employeeSalary.findMany({
      where: { tenantId, employeeId },
      include: {
        salaryStructure: { select: { id: true, name: true, components: true } },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async assignSalary(
    tenantId: string,
    employeeId: string,
    dto: AssignSalaryDto,
  ) {
    // Verify employee exists
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) throw new NotFoundException('Employee not found');

    // Verify structure exists
    const structure = await this.prisma.salaryStructure.findFirst({
      where: { id: dto.salaryStructureId, tenantId, isActive: true },
    });
    if (!structure) throw new NotFoundException('Salary structure not found');

    // Deactivate previous active salary
    await this.prisma.employeeSalary.updateMany({
      where: { tenantId, employeeId, isActive: true },
      data: {
        isActive: false,
        effectiveTo: new Date(dto.effectiveFrom),
      },
    });

    return this.prisma.employeeSalary.create({
      data: {
        tenantId,
        employeeId,
        salaryStructureId: dto.salaryStructureId,
        basePay: dto.basePay,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
      },
      include: {
        salaryStructure: { select: { id: true, name: true } },
      },
    });
  }
}
