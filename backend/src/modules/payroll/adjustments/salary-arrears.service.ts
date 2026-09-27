import { Injectable, NotImplementedException } from '@nestjs/common';
import { SalaryArrearStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ArrearDetectionResult, SalaryArrearView } from '../payroll-depth.types';

export interface SalaryArrearQuery {
  status?: SalaryArrearStatus;
  employeeId?: string;
}

/**
 * WS-C1 (Keka wave C, spec C1): arrears from backdated salary revisions.
 * Scaffold stub — implemented by WS-C1.
 */
@Injectable()
export class SalaryArrearsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, query: SalaryArrearQuery): Promise<SalaryArrearView[]> {
    void tenantId;
    void query;
    throw new NotImplementedException();
  }

  /** Idempotent: writes one SalaryArrear per month a revision changes. */
  detectForEmployee(tenantId: string, employeeId: string): Promise<ArrearDetectionResult> {
    void tenantId;
    void employeeId;
    throw new NotImplementedException();
  }

  /** PENDING only. */
  cancel(tenantId: string, id: string): Promise<SalaryArrearView> {
    void tenantId;
    void id;
    throw new NotImplementedException();
  }
}
