import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AccountingConfigView } from './accounting.types';

const DEFAULTS: AccountingConfigView = {
  suspenseGlCode: null,
  suspenseGlName: null,
  costCenterMode: 'NONE',
  tallyCompanyName: null,
  tallyVoucherType: 'Journal',
  narrationTemplate: 'Salary for {{month}} {{year}}',
};

/**
 * WS-C2 (Keka wave C, spec C7): export settings. A tenant with no row reads
 * the schema defaults.
 */
@Injectable()
export class AccountingConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(tenantId: string): Promise<AccountingConfigView> {
    const row = await this.prisma.payrollAccountingConfig.findUnique({ where: { tenantId } });
    if (!row) return { ...DEFAULTS };
    return {
      suspenseGlCode: row.suspenseGlCode,
      suspenseGlName: row.suspenseGlName,
      costCenterMode: row.costCenterMode,
      tallyCompanyName: row.tallyCompanyName,
      tallyVoucherType: row.tallyVoucherType,
      narrationTemplate: row.narrationTemplate,
    };
  }

  async update(actor: AuthenticatedUser, input: Partial<AccountingConfigView>): Promise<AccountingConfigView> {
    const before = await this.get(actor.tenantId);

    // A blank string clears a previously configured value back to null,
    // rather than being rejected: "stop using a suspense account" is a
    // normal configuration change, not invalid input.
    const clean = (value: string | null | undefined): string | null | undefined => {
      if (value === undefined) return undefined;
      const trimmed = value?.trim() ?? '';
      return trimmed.length === 0 ? null : trimmed;
    };

    const data: Record<string, unknown> = {};
    if ('suspenseGlCode' in input) data.suspenseGlCode = clean(input.suspenseGlCode);
    if ('suspenseGlName' in input) data.suspenseGlName = clean(input.suspenseGlName);
    if ('costCenterMode' in input) data.costCenterMode = input.costCenterMode;
    if ('tallyCompanyName' in input) data.tallyCompanyName = clean(input.tallyCompanyName);
    if ('tallyVoucherType' in input) {
      const trimmed = clean(input.tallyVoucherType);
      data.tallyVoucherType = trimmed ?? DEFAULTS.tallyVoucherType;
    }
    if ('narrationTemplate' in input) {
      const trimmed = clean(input.narrationTemplate);
      data.narrationTemplate = trimmed ?? DEFAULTS.narrationTemplate;
    }

    const row = await this.prisma.payrollAccountingConfig.upsert({
      where: { tenantId: actor.tenantId },
      create: { tenantId: actor.tenantId, ...data },
      update: data,
    });

    await this.audit.log({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'PayrollAccountingConfig',
      entityId: row.id,
      oldValues: before as unknown as Record<string, unknown>,
      newValues: { ...before, ...input } as unknown as Record<string, unknown>,
    });

    return this.get(actor.tenantId);
  }
}
