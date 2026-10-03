import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateCompetencyDto,
  SetDesignationCompetenciesDto,
  UpdateCompetencyDto,
} from './dto/competencies.dto';

const NAME_TAKEN = 'A competency with this name already exists';

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** Competency library and designation mapping (spec F3). Admin-only at the controller. */
@Injectable()
export class CompetenciesService {
  constructor(private prisma: PrismaService) {}

  async list(tenantId: string) {
    const rows = await this.prisma.competency.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { designations: true } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, mappedDesignations: _count.designations }));
  }

  async create(tenantId: string, dto: CreateCompetencyDto) {
    try {
      return await this.prisma.competency.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description,
          category: dto.category,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(NAME_TAKEN);
      throw e;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateCompetencyDto) {
    await this.findOrThrow(tenantId, id);
    const data: Prisma.CompetencyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    try {
      return await this.prisma.competency.update({ where: { id }, data });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException(NAME_TAKEN);
      throw e;
    }
  }

  /** A competency mapped to any designation can be deactivated but not deleted. */
  async remove(tenantId: string, id: string) {
    await this.findOrThrow(tenantId, id);
    const mapped = await this.prisma.designationCompetency.count({
      where: { tenantId, competencyId: id },
    });
    if (mapped > 0) {
      throw new BadRequestException(
        'This competency is mapped to designations; deactivate it instead of deleting it',
      );
    }
    await this.prisma.competency.delete({ where: { id } });
    return { message: 'Competency deleted' };
  }

  private async findOrThrow(tenantId: string, id: string) {
    const competency = await this.prisma.competency.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!competency) throw new NotFoundException('Competency not found');
    return competency;
  }

  // ============================================
  // Designation mapping
  // ============================================

  private async assertDesignation(tenantId: string, designationId: string) {
    const designation = await this.prisma.designation.findFirst({
      where: { id: designationId, tenantId },
      select: { id: true },
    });
    if (!designation) throw new NotFoundException('Designation not found');
  }

  private mappedList(tenantId: string, designationId: string) {
    return this.prisma.designationCompetency.findMany({
      where: { tenantId, designationId },
      select: {
        competencyId: true,
        expectedLevel: true,
        competency: { select: { id: true, name: true, isActive: true } },
      },
      orderBy: { competency: { name: 'asc' } },
    });
  }

  async getForDesignation(tenantId: string, designationId: string) {
    await this.assertDesignation(tenantId, designationId);
    return this.mappedList(tenantId, designationId);
  }

  /** Replaces the designation's whole list: validates, then deleteMany + createMany in one transaction. */
  async setForDesignation(
    tenantId: string,
    designationId: string,
    dto: SetDesignationCompetenciesDto,
  ) {
    await this.assertDesignation(tenantId, designationId);

    const ids = dto.items.map((i) => i.competencyId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Each competency can appear only once');
    }
    for (const item of dto.items) {
      if (!Number.isInteger(item.expectedLevel) || item.expectedLevel < 1 || item.expectedLevel > 5) {
        throw new BadRequestException('Expected level must be a whole number from 1 to 5');
      }
    }
    if (ids.length > 0) {
      const found = await this.prisma.competency.findMany({
        where: { id: { in: ids }, tenantId, isActive: true },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        throw new BadRequestException('Every competency must exist and be active');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.designationCompetency.deleteMany({ where: { tenantId, designationId } });
      if (dto.items.length > 0) {
        await tx.designationCompetency.createMany({
          data: dto.items.map((i) => ({
            tenantId,
            designationId,
            competencyId: i.competencyId,
            expectedLevel: i.expectedLevel,
          })),
        });
      }
    });

    return this.mappedList(tenantId, designationId);
  }
}
