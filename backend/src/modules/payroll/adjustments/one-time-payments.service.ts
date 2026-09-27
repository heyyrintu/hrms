import { Injectable, NotImplementedException } from '@nestjs/common';
import { OneTimePaymentKind } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { OneTimePaymentView } from '../payroll-depth.types';

export interface CreateOneTimePaymentInput {
  employeeId: string;
  kind: OneTimePaymentKind;
  name: string;
  amount: number;
  /** Earnings only; ignored (stored false) for RECOVERY / OTHER_DEDUCTION. */
  taxable?: boolean;
  note?: string | null;
}

/**
 * WS-C1 (Keka wave C, spec C2): bonus / incentive / deduction lines attached
 * to a DRAFT or COMPUTED run. Scaffold stub — implemented by WS-C1.
 */
@Injectable()
export class OneTimePaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  listForRun(tenantId: string, runId: string): Promise<OneTimePaymentView[]> {
    void tenantId;
    void runId;
    throw new NotImplementedException();
  }

  create(
    actor: AuthenticatedUser,
    runId: string,
    input: CreateOneTimePaymentInput,
  ): Promise<OneTimePaymentView> {
    void actor;
    void runId;
    void input;
    throw new NotImplementedException();
  }

  remove(tenantId: string, id: string): Promise<void> {
    void tenantId;
    void id;
    throw new NotImplementedException();
  }
}
