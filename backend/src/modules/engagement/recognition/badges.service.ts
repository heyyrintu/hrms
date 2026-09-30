import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { isPrismaError, PRISMA_UNIQUE_VIOLATION } from '../../../common/utils/prisma-errors';
import { CreateBadgeDto, UpdateBadgeDto } from './dto/recognition.dto';

/** Seeded once per tenant, the first time badges are listed for it. */
export const DEFAULT_BADGES: ReadonlyArray<{ name: string; icon: string; points: number }> = [
  { name: 'Team Player', icon: '🤝', points: 10 },
  { name: 'Above and Beyond', icon: '🚀', points: 20 },
  { name: 'Customer Hero', icon: '🏆', points: 20 },
  { name: 'Innovator', icon: '💡', points: 15 },
  { name: 'Thank You', icon: '🙏', points: 5 },
];

/** Badge catalog for recognition. Deactivating keeps history intact. */
@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Seeds the five defaults the first time a tenant has none, then returns the catalog. */
  async list(tenantId: string, includeInactive: boolean) {
    const existingCount = await this.prisma.badge.count({ where: { tenantId } });
    if (existingCount === 0) {
      await this.prisma.badge.createMany({
        data: DEFAULT_BADGES.map((badge) => ({ tenantId, ...badge })),
        skipDuplicates: true,
      });
    }
    return this.prisma.badge.findMany({
      where: includeInactive ? { tenantId } : { tenantId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async create(tenantId: string, dto: CreateBadgeDto) {
    try {
      return await this.prisma.badge.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description ?? null,
          icon: dto.icon,
          points: dto.points ?? 0,
        },
      });
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictException('A badge with this name already exists');
      }
      throw error;
    }
  }

  async update(tenantId: string, id: string, dto: UpdateBadgeDto) {
    const existing = await this.prisma.badge.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Badge not found');

    try {
      return await this.prisma.badge.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.icon !== undefined && { icon: dto.icon }),
          ...(dto.points !== undefined && { points: dto.points }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_VIOLATION)) {
        throw new ConflictException('A badge with this name already exists');
      }
      throw error;
    }
  }

  /** "Delete" keeps the row (recognitions reference it) but hides it from new use. */
  async deactivate(tenantId: string, id: string) {
    const existing = await this.prisma.badge.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Badge not found');
    return this.prisma.badge.update({ where: { id }, data: { isActive: false } });
  }
}
