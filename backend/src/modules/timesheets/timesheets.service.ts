import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalEngineService } from '../workflow/approval-engine.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

/** Weekly timesheets (Keka wave G, WS-T). Scaffold stub. */
@Injectable()
export class TimesheetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ApprovalEngineService,
    private readonly notifications: NotificationsService,
  ) {}

  approve(_actor: AuthenticatedUser, _id: string, _note?: string | null): Promise<unknown> {
    throw new NotImplementedException();
  }

  reject(_actor: AuthenticatedUser, _id: string, _note?: string | null): Promise<unknown> {
    throw new NotImplementedException();
  }
}
