import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDesignationDto, UpdateDesignationDto } from './dto/designation.dto';

@Injectable()
export class DesignationsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateDesignationDto) {
    const existing = await this.prisma.designation.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });

    if (existing) {
      throw new ConflictException('Designation name already exists');
    }

    return this.prisma.designation.create({
      data: { tenantId, name: dto.name },
      include: { _count: { select: { employees: true } } },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.designation.findMany({
      where: { tenantId },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const designation = await this.prisma.designation.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { employees: true } } },
    });

    if (!designation) {
      throw new NotFoundException('Designation not found');
    }

    return designation;
  }

  async update(tenantId: string, id: string, dto: UpdateDesignationDto) {
    await this.findOne(tenantId, id);

    if (dto.name) {
      const existing = await this.prisma.designation.findFirst({
        where: { tenantId, name: dto.name, NOT: { id } },
      });

      if (existing) {
        throw new ConflictException('Designation name already exists');
      }
    }

    return this.prisma.designation.update({
      where: { id },
      data: dto,
      include: { _count: { select: { employees: true } } },
    });
  }

  async remove(tenantId: string, id: string) {
    const designation = await this.findOne(tenantId, id);

    if (designation._count.employees > 0) {
      throw new ConflictException(
        'Cannot delete designation with employees. Reassign employees first.',
      );
    }

    return this.prisma.designation.delete({ where: { id } });
  }
}
