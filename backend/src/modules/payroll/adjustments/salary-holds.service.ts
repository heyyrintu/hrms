import { Injectable, NotImplementedException } from '@nestjs/common';
import { SalaryHoldStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { SalaryHoldView } from '../payroll-depth.types';

/**
 * WS-C1 (Keka wave C, spec C3): hold an employee's net pay in a run, release it
 * later as a non-taxable line in another run, or void it.
 * Scaffold stub — implemented by WS-C1.
 */
@Injectable()
export class SalaryHoldsService {
  constructor(private readonly prisma: PrismaService) {}

  listForRun(tenantId: string, runId: string): Promise<SalaryHoldView[]> {
    void tenantId;
    void runId;
    throw new NotImplementedException();
  }

  list(tenantId: string, status?: SalaryHoldStatus): Promise<SalaryHoldView[]> {
    void tenantId;
    void status;
    throw new NotImplementedException();
  }

  hold(
    actor: AuthenticatedUser,
    runId: string,
    input: { employeeId: string; reason: string },
  ): Promise<SalaryHoldView> {
    void actor;
    void runId;
    void input;
    throw new NotImplementedException();
  }

  /** HELD and the run not PAID. */
  unhold(tenantId: string, id: string): Promise<void> {
    void tenantId;
    void id;
    throw new NotImplementedException();
  }

  release(actor: AuthenticatedUser, id: string, targetRunId: string): Promise<SalaryHoldView> {
    void actor;
    void id;
    void targetRunId;
    throw new NotImplementedException();
  }

  void(actor: AuthenticatedUser, id: string, reason: string): Promise<SalaryHoldView> {
    void actor;
    void id;
    void reason;
    throw new NotImplementedException();
  }
}
