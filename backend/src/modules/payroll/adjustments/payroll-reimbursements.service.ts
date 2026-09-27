import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RunReimbursementsView } from '../payroll-depth.types';

/**
 * WS-C1 (Keka wave C, spec C4): approved expense claims paid through payroll.
 * Scaffold stub — implemented by WS-C1 (attach/detach/settle helpers are
 * called from PayrollService inside the run's write transaction).
 */
@Injectable()
export class PayrollReimbursementsService {
  constructor(private readonly prisma: PrismaService) {}

  getForRun(tenantId: string, runId: string): Promise<RunReimbursementsView> {
    void tenantId;
    void runId;
    throw new NotImplementedException();
  }
}
