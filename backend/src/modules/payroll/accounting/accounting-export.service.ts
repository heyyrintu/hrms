import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AccountingExportFormat, JournalPreview } from './accounting.types';

export interface AccountingExportFile {
  filename: string;
  contentType: string;
  content: string;
}

/**
 * WS-C2 (Keka wave C, spec C7): journal voucher preview and CSV / Tally XML
 * export of a payroll run. Scaffold stub.
 */
@Injectable()
export class AccountingExportService {
  constructor(private readonly prisma: PrismaService) {}

  preview(tenantId: string, runId: string, allowUnmapped: boolean): Promise<JournalPreview> {
    void tenantId;
    void runId;
    void allowUnmapped;
    throw new NotImplementedException();
  }

  /** APPROVED / PAID runs only; audit-logged. */
  export(
    actor: AuthenticatedUser,
    runId: string,
    format: AccountingExportFormat,
    allowUnmapped: boolean,
  ): Promise<AccountingExportFile> {
    void actor;
    void runId;
    void format;
    void allowUnmapped;
    throw new NotImplementedException();
  }
}
