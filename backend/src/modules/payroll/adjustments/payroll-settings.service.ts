import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PayrollSettingsView } from '../payroll-depth.types';

/** What a tenant with no PayrollSettings row gets (the schema defaults). */
export const DEFAULT_PAYROLL_SETTINGS: PayrollSettingsView = {
  reimburseExpensesViaPayroll: false,
  autoArrears: true,
};

type SettingsReader = Pick<Prisma.TransactionClient, 'payrollSettings'>;

/**
 * WS-C1 (Keka wave C): per-tenant payroll switches. A tenant with no row reads
 * the defaults (reimburseExpensesViaPayroll false, autoArrears true); reading
 * never creates a row, so a tenant that never opens the page stays row-less.
 */
@Injectable()
export class PayrollSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(tenantId: string, client: SettingsReader = this.prisma): Promise<PayrollSettingsView> {
    const row = await client.payrollSettings.findUnique({ where: { tenantId } });
    if (!row) return { ...DEFAULT_PAYROLL_SETTINGS };
    return {
      reimburseExpensesViaPayroll: row.reimburseExpensesViaPayroll,
      autoArrears: row.autoArrears,
    };
  }

  async update(tenantId: string, input: Partial<PayrollSettingsView>): Promise<PayrollSettingsView> {
    // Only the two switches; anything else in the body (tenantId, ids) is
    // dropped rather than written.
    const data: Partial<PayrollSettingsView> = {};
    if (typeof input.reimburseExpensesViaPayroll === 'boolean') {
      data.reimburseExpensesViaPayroll = input.reimburseExpensesViaPayroll;
    }
    if (typeof input.autoArrears === 'boolean') data.autoArrears = input.autoArrears;

    const row = await this.prisma.payrollSettings.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });
    return {
      reimburseExpensesViaPayroll: row.reimburseExpensesViaPayroll,
      autoArrears: row.autoArrears,
    };
  }
}
