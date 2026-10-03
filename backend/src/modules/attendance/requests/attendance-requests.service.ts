import { Injectable, NotImplementedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApprovalEngineService } from '../../workflow/approval-engine.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import type { CoveringRequest } from './attendance-requests.types';

/** WFH and on-duty requests (Keka wave G, WS-A). Scaffold stub. */
@Injectable()
export class AttendanceRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApprovalEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The APPROVED request whose dates cover `date` for the employee, or null. */
  findApprovedCovering(
    _tenantId: string,
    _employeeId: string,
    _date: Date,
    _tx?: Prisma.TransactionClient,
  ): Promise<CoveringRequest | null> {
    throw new NotImplementedException();
  }

  approve(_actor: AuthenticatedUser, _id: string, _note?: string | null): Promise<unknown> {
    throw new NotImplementedException();
  }

  reject(_actor: AuthenticatedUser, _id: string, _note?: string | null): Promise<unknown> {
    throw new NotImplementedException();
  }
}
