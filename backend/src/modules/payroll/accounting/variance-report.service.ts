import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { VarianceReport } from './accounting.types';
import { AccountingExportFile } from './accounting-export.service';

export interface VarianceQuery {
  runId: string;
  /** Default: the previous month's REGULAR run. */
  compareRunId?: string;
  /** Default 10. */
  thresholdPct?: number;
}

/**
 * WS-C2 (Keka wave C, spec C8): this run against a previous one, per employee
 * and per component. Scaffold stub.
 */
@Injectable()
export class VarianceReportService {
  constructor(private readonly prisma: PrismaService) {}

  build(tenantId: string, query: VarianceQuery): Promise<VarianceReport> {
    void tenantId;
    void query;
    throw new NotImplementedException();
  }

  exportCsv(tenantId: string, query: VarianceQuery): Promise<AccountingExportFile> {
    void tenantId;
    void query;
    throw new NotImplementedException();
  }
}
