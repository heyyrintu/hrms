import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateHolidayDto,
  UpdateHolidayDto,
  HolidayQueryDto,
} from './dto/holiday.dto';

@Injectable()
export class HolidaysService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateHolidayDto) {
    const existing = await this.prisma.holiday.findFirst({
      where: {
        tenantId,
        date: new Date(dto.date),
        name: dto.name,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Holiday "${dto.name}" already exists on ${dto.date}`,
      );
    }

    return this.prisma.holiday.create({
      data: {
        tenantId,
        name: dto.name,
        date: new Date(dto.date),
        type: dto.type,
        region: dto.region,
        isOptional: dto.isOptional ?? false,
        description: dto.description,
      },
    });
  }

  async bulkCreate(tenantId: string, holidays: CreateHolidayDto[]) {
    const results = [];
    for (const dto of holidays) {
      try {
        const holiday = await this.create(tenantId, dto);
        results.push({ success: true, holiday });
      } catch (error) {
        results.push({
          success: false,
          name: dto.name,
          date: dto.date,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return results;
  }

  async findAll(tenantId: string, query: HolidayQueryDto) {
    const where: any = { tenantId, isActive: true };

    if (query.year) {
      const startOfYear = new Date(`${query.year}-01-01`);
      const endOfYear = new Date(`${query.year}-12-31`);
      where.date = { gte: startOfYear, lte: endOfYear };
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.isOptional !== undefined) {
      where.isOptional = query.isOptional;
    }

    return this.prisma.holiday.findMany({
      where,
      orderBy: { date: 'asc' },
    });
  }

  async findUpcoming(tenantId: string, limit: number = 5) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return this.prisma.holiday.findMany({
      where: {
        tenantId,
        isActive: true,
        date: { gte: today },
      },
      orderBy: { date: 'asc' },
      take: limit,
    });
  }

  async findById(tenantId: string, id: string) {
    const holiday = await this.prisma.holiday.findFirst({
      where: { id, tenantId },
    });

    if (!holiday) {
      throw new NotFoundException('Holiday not found');
    }

    return holiday;
  }

  async update(tenantId: string, id: string, dto: UpdateHolidayDto) {
    await this.findById(tenantId, id);

    return this.prisma.holiday.update({
      where: { id },
      data: {
        ...dto,
        date: dto.date ? new Date(dto.date) : undefined,
      },
    });
  }

  async delete(tenantId: string, id: string) {
    await this.findById(tenantId, id);

    return this.prisma.holiday.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async isHoliday(tenantId: string, date: Date): Promise<boolean> {
    const holiday = await this.prisma.holiday.findFirst({
      where: {
        tenantId,
        date,
        isActive: true,
        isOptional: false,
      },
    });

    return !!holiday;
  }

  async getHolidaysBetween(
    tenantId: string,
    startDate: Date,
    endDate: Date,
  ) {
    return this.prisma.holiday.findMany({
      where: {
        tenantId,
        isActive: true,
        isOptional: false,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });
  }
}
