import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateBranchDto) {
    const existing = await this.prisma.branch.findUnique({
      where: { tenantId_name: { tenantId, name: dto.name } },
    });

    if (existing) {
      throw new ConflictException('Branch name already exists');
    }

    return this.prisma.branch.create({
      data: {
        tenantId,
        name: dto.name,
        type: dto.type ?? 'HEAD_OFFICE',
        address: dto.address,
        city: dto.city,
        state: dto.state,
        zipCode: dto.zipCode,
        country: dto.country,
      },
      include: { _count: { select: { employees: true } } },
    });
  }

  async findAll(tenantId: string) {
    return this.prisma.branch.findMany({
      where: { tenantId },
      include: { _count: { select: { employees: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { employees: true } } },
    });

    if (!branch) {
      throw new NotFoundException('Branch not found');
    }

    return branch;
  }

  async update(tenantId: string, id: string, dto: UpdateBranchDto) {
    await this.findOne(tenantId, id);

    if (dto.name) {
      const existing = await this.prisma.branch.findFirst({
        where: { tenantId, name: dto.name, NOT: { id } },
      });

      if (existing) {
        throw new ConflictException('Branch name already exists');
      }
    }

    return this.prisma.branch.update({
      where: { id },
      data: dto,
      include: { _count: { select: { employees: true } } },
    });
  }

  async remove(tenantId: string, id: string) {
    const branch = await this.findOne(tenantId, id);

    if (branch._count.employees > 0) {
      throw new ConflictException(
        'Cannot delete branch with employees. Reassign employees first.',
      );
    }

    return this.prisma.branch.delete({ where: { id } });
  }
}
