import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { GL_SYSTEM_KEYS } from './accounting.types';
import { GL_SYSTEM_KEY_META } from './journal-builder';
import { GlKnownKey, GlMappingView, GlMappingsResponse } from './accounting.types';

const ONE_TIME_EARNING_KINDS = new Set(['BONUS', 'INCENTIVE', 'COMMISSION', 'OTHER_EARNING']);
const KNOWN_KEY_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * WS-C2 (Keka wave C, spec C7): per-tenant GL mapping.
 */
@Injectable()
export class GlMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getMappings(tenantId: string): Promise<GlMappingsResponse> {
    const rows = await this.prisma.payrollGlMapping.findMany({
      where: { tenantId },
      orderBy: { componentKey: 'asc' },
    });

    const mappings: GlMappingView[] = rows.map((r) => ({
      componentKey: r.componentKey,
      glCode: r.glCode,
      glName: r.glName,
    }));
    const mappedKeys = new Set(mappings.map((m) => m.componentKey));

    const knownKeys = await this.buildKnownKeys(tenantId, mappedKeys);

    return { mappings, knownKeys };
  }

  /** Replaces the tenant's whole mapping set in one transaction; audit-logged. */
  async replaceMappings(actor: AuthenticatedUser, mappings: GlMappingView[]): Promise<GlMappingsResponse> {
    const seen = new Set<string>();
    const cleaned: GlMappingView[] = [];
    for (const raw of mappings) {
      const componentKey = raw.componentKey?.trim();
      const glCode = raw.glCode?.trim();
      const glName = raw.glName?.trim();
      if (!componentKey || !glCode || !glName) {
        throw new BadRequestException('Every mapping needs a component key, a GL code and a GL name');
      }
      if (seen.has(componentKey)) {
        throw new BadRequestException(`Duplicate mapping for "${componentKey}"`);
      }
      seen.add(componentKey);
      cleaned.push({ componentKey, glCode, glName });
    }

    const before = await this.prisma.payrollGlMapping.findMany({
      where: { tenantId: actor.tenantId },
      select: { componentKey: true, glCode: true, glName: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.payrollGlMapping.deleteMany({ where: { tenantId: actor.tenantId } });
      if (cleaned.length > 0) {
        await tx.payrollGlMapping.createMany({
          data: cleaned.map((m) => ({ tenantId: actor.tenantId, ...m })),
        });
      }
      await this.audit.log(
        {
          tenantId: actor.tenantId,
          userId: actor.userId,
          action: AuditAction.UPDATE,
          entityType: 'PayrollGlMapping',
          oldValues: { mappings: before },
          newValues: { mappings: cleaned },
        },
        tx,
      );
    });

    return this.getMappings(actor.tenantId);
  }

  /**
   * System keys, plus every earning/deduction component name from an active
   * salary structure, plus distinct one-time payment names used in the last
   * 12 months — each flagged with whether it already has a mapping.
   */
  private async buildKnownKeys(tenantId: string, mappedKeys: Set<string>): Promise<GlKnownKey[]> {
    const keys = new Map<string, GlKnownKey>();

    for (const key of GL_SYSTEM_KEYS) {
      const meta = GL_SYSTEM_KEY_META[key];
      keys.set(key, {
        key,
        label: meta.label,
        category: meta.category,
        side: meta.side,
        isSystem: true,
        mapped: mappedKeys.has(key),
      });
    }

    const structures = await this.prisma.salaryStructure.findMany({
      where: { tenantId, isActive: true },
      select: { components: true },
    });
    for (const structure of structures) {
      const components = (structure.components ?? []) as unknown as {
        name: string;
        type: 'earning' | 'deduction';
      }[];
      for (const component of components) {
        if (!component?.name || keys.has(component.name)) continue;
        keys.set(component.name, {
          key: component.name,
          label: component.name,
          category: component.type === 'earning' ? 'EARNING' : 'DEDUCTION',
          side: component.type === 'earning' ? 'DEBIT' : 'CREDIT',
          isSystem: false,
          mapped: mappedKeys.has(component.name),
        });
      }
    }

    const since = new Date(Date.now() - KNOWN_KEY_LOOKBACK_MS);
    const payments = await this.prisma.payrollOneTimePayment.findMany({
      where: { tenantId, createdAt: { gte: since } },
      select: { name: true, kind: true },
      distinct: ['name'],
    });
    for (const payment of payments) {
      if (keys.has(payment.name)) continue;
      const isEarning = ONE_TIME_EARNING_KINDS.has(payment.kind);
      keys.set(payment.name, {
        key: payment.name,
        label: payment.name,
        category: isEarning ? 'EARNING' : 'DEDUCTION',
        side: isEarning ? 'DEBIT' : 'CREDIT',
        isSystem: false,
        mapped: mappedKeys.has(payment.name),
      });
    }

    return Array.from(keys.values());
  }
}
