import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateEngagementSettingsDto } from './dto/engagement-settings.dto';

export interface EngagementSettingsView {
  pointsEnabled: boolean;
  monthlyPointsAllowance: number;
  showBirthdays: boolean;
  showAnniversaries: boolean;
}

/** What a tenant gets before anyone saves settings: points off, celebrations on. */
export const DEFAULT_ENGAGEMENT_SETTINGS: EngagementSettingsView = Object.freeze({
  pointsEnabled: false,
  monthlyPointsAllowance: 100,
  showBirthdays: true,
  showAnniversaries: true,
});

const VIEW_SELECT = {
  pointsEnabled: true,
  monthlyPointsAllowance: true,
  showBirthdays: true,
  showAnniversaries: true,
} as const;

function toView(row: EngagementSettingsView): EngagementSettingsView {
  return {
    pointsEnabled: row.pointsEnabled,
    monthlyPointsAllowance: row.monthlyPointsAllowance,
    showBirthdays: row.showBirthdays,
    showAnniversaries: row.showAnniversaries,
  };
}

/**
 * Per-tenant engagement settings (recognition points, feed celebrations).
 * A missing row means the defaults; the row is created on first update.
 */
@Injectable()
export class EngagementSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, tx?: Prisma.TransactionClient): Promise<EngagementSettingsView> {
    const db = tx ?? this.prisma;
    const row = await db.engagementSettings.findUnique({
      where: { tenantId },
      select: VIEW_SELECT,
    });
    return row ? toView(row) : { ...DEFAULT_ENGAGEMENT_SETTINGS };
  }

  async update(
    tenantId: string,
    dto: UpdateEngagementSettingsDto,
  ): Promise<EngagementSettingsView> {
    const changes: Partial<EngagementSettingsView> = {};
    if (dto.pointsEnabled !== undefined) changes.pointsEnabled = dto.pointsEnabled;
    if (dto.monthlyPointsAllowance !== undefined) {
      changes.monthlyPointsAllowance = dto.monthlyPointsAllowance;
    }
    if (dto.showBirthdays !== undefined) changes.showBirthdays = dto.showBirthdays;
    if (dto.showAnniversaries !== undefined) changes.showAnniversaries = dto.showAnniversaries;

    const row = await this.prisma.engagementSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...DEFAULT_ENGAGEMENT_SETTINGS, ...changes },
      update: changes,
      select: VIEW_SELECT,
    });
    return toView(row);
  }
}
