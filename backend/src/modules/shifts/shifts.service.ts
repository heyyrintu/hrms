import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateShiftDto,
  UpdateShiftDto,
  AssignShiftDto,
} from './dto/shift.dto';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  // ---- Shift CRUD ----

  async createShift(tenantId: string, dto: CreateShiftDto) {
    const existing = await this.prisma.shift.findFirst({
      where: { tenantId, code: dto.code },
    });

    if (existing) {
      throw new ConflictException(`Shift with code "${dto.code}" already exists`);
    }

    return this.prisma.shift.create({
      data: {
        tenantId,
        name: dto.name,
        code: dto.code,
        startTime: dto.startTime,
        endTime: dto.endTime,
        breakMinutes: dto.breakMinutes ?? 60,
        standardWorkMinutes: dto.standardWorkMinutes ?? 480,
        graceMinutes: dto.graceMinutes ?? 15,
      },
    });
  }

  async findAllShifts(tenantId: string) {
    return this.prisma.shift.findMany({
      where: { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findShiftById(tenantId: string, id: string) {
    const shift = await this.prisma.shift.findFirst({
      where: { id, tenantId },
    });

    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    return shift;
  }

  async updateShift(tenantId: string, id: string, dto: UpdateShiftDto) {
    await this.findShiftById(tenantId, id);

    if (dto.code) {
      const existing = await this.prisma.shift.findFirst({
        where: { tenantId, code: dto.code, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException(`Shift with code "${dto.code}" already exists`);
      }
    }

    return this.prisma.shift.update({
      where: { id },
      data: dto,
    });
  }

  async deleteShift(tenantId: string, id: string) {
    await this.findShiftById(tenantId, id);

    return this.prisma.shift.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ---- Shift Assignments ----

  async assignShift(tenantId: string, dto: AssignShiftDto) {
    // Verify employee and shift exist in this tenant
    const employee = await this.prisma.employee.findFirst({
      where: { id: dto.employeeId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const shift = await this.findShiftById(tenantId, dto.shiftId);
    if (!shift) {
      throw new NotFoundException('Shift not found');
    }

    // Deactivate any current active assignment for this employee
    await this.prisma.shiftAssignment.updateMany({
      where: {
        tenantId,
        employeeId: dto.employeeId,
        isActive: true,
      },
      data: {
        isActive: false,
        endDate: new Date(dto.startDate),
      },
    });

    return this.prisma.shiftAssignment.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        shiftId: dto.shiftId,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        shift: { select: { name: true, code: true } },
      },
    });
  }

  async bulkAssignShift(
    tenantId: string,
    shiftId: string,
    employeeIds: string[],
    startDate: string,
    endDate?: string,
  ) {
    const results = [];
    for (const employeeId of employeeIds) {
      try {
        const assignment = await this.assignShift(tenantId, {
          employeeId,
          shiftId,
          startDate,
          endDate,
        });
        results.push({ success: true, assignment });
      } catch (error) {
        results.push({
          success: false,
          employeeId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return results;
  }

  async getAssignments(tenantId: string, activeOnly: boolean = true) {
    return this.prisma.shiftAssignment.findMany({
      where: {
        tenantId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        shift: { select: { name: true, code: true, startTime: true, endTime: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getEmployeeShiftHistory(tenantId: string, employeeId: string) {
    return this.prisma.shiftAssignment.findMany({
      where: { tenantId, employeeId },
      include: {
        shift: { select: { name: true, code: true, startTime: true, endTime: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async getCurrentShift(tenantId: string, employeeId: string) {
    const assignment = await this.prisma.shiftAssignment.findFirst({
      where: {
        tenantId,
        employeeId,
        isActive: true,
      },
      include: {
        shift: true,
      },
      orderBy: { startDate: 'desc' },
    });

    return assignment?.shift || null;
  }
}
