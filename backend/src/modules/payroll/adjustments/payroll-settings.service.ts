import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PayrollSettingsView } from '../payroll-depth.types';

/**
 * WS-C1 (Keka wave C): per-tenant payroll switches. A tenant with no row reads
 * the defaults (reimburseExpensesViaPayroll false, autoArrears true).
 * Scaffold stub — implemented by WS-C1.
 */
@Injectable()
export class PayrollSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  get(tenantId: string): Promise<PayrollSettingsView> {
    void tenantId;
    throw new NotImplementedException();
  }

  update(tenantId: string, input: Partial<PayrollSettingsView>): Promise<PayrollSettingsView> {
    void tenantId;
    void input;
    throw new NotImplementedException();
  }
}
