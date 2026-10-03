import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

const WITH_DAYS = { days: { orderBy: { dayIndex: 'asc' } } } as const;

export interface RotationPatternInput {
  name: string;
  description?: string;
  days: (string | null)[];
}

/** Shift rotation patterns (Keka wave G, WS-R). */
@Injectable()
export class RotationPatternsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.shiftRotationPattern.findMany({
      where: { tenantId, isActive: true },
      include: WITH_DAYS,
      orderBy: { name: 'asc' },
    });
  }

  async create(actor: AuthenticatedUser, input: RotationPatternInput) {
    await this.assertDays(actor.tenantId, input.days);

    return this.prisma.shiftRotationPattern.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name,
        description: input.description ?? null,
        cycleLength: input.days.length,
        createdById: actor.userId,
        days: {
          create: input.days.map((shiftId, dayIndex) => ({ dayIndex, shiftId })),
        },
      },
      include: WITH_DAYS,
    });
  }

  async update(tenantId: string, id: string, input: RotationPatternInput) {
    const existing = await this.prisma.shiftRotationPattern.findFirst({
      where: { id, tenantId, isActive: true },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Rotation pattern not found');

    await this.assertDays(tenantId, input.days);

    // Existing roster entries keep their patternId, which stays informational.
    return this.prisma.$transaction(async (tx) => {
      await tx.shiftRotationPatternDay.deleteMany({ where: { patternId: id } });
      await tx.shiftRotationPatternDay.createMany({
        data: input.days.map((shiftId, dayIndex) => ({ patternId: id, dayIndex, shiftId })),
      });
      return tx.shiftRotationPattern.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description ?? null,
          cycleLength: input.days.length,
        },
        include: WITH_DAYS,
      });
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const result = await this.prisma.shiftRotationPattern.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });
    if (result.count === 0) throw new NotFoundException('Rotation pattern not found');
  }

  /** 1..31 days, and every non-null entry an active shift of this tenant. */
  private async assertDays(tenantId: string, days: (string | null)[]): Promise<void> {
    if (!Array.isArray(days) || days.length < 1 || days.length > 31) {
      throw new BadRequestException('A pattern needs between 1 and 31 days');
    }
    if (days.some((d) => d !== null && (typeof d !== 'string' || d.length === 0))) {
      throw new BadRequestException('Each day must be a shift id or null for OFF');
    }

    const shiftIds = [...new Set(days.filter((d): d is string => d !== null))];
    if (shiftIds.length === 0) return;

    const found = await this.prisma.shift.findMany({
      where: { tenantId, id: { in: shiftIds }, isActive: true },
      select: { id: true },
    });
    if (found.length !== shiftIds.length) {
      const known = new Set(found.map((s) => s.id));
      const missing = shiftIds.filter((id) => !known.has(id));
      throw new BadRequestException(`Unknown or inactive shift: ${missing.join(', ')}`);
    }
  }
}
