import { Injectable, NotImplementedException } from '@nestjs/common';
import { WorkflowEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../workflow/workflow.types';
import { TimesheetsService } from './timesheets.service';

/**
 * Connects weekly timesheets to the approval engine (Keka wave G, WS-T).
 *
 * Scaffold stub: it does NOT register with the registry yet. The owning
 * workstream adds `OnModuleInit` / `onModuleInit() { this.registry.register(this); }`.
 */
@Injectable()
export class TimesheetWorkflowHandler implements WorkflowEntityHandler {
  readonly entityType = WorkflowEntityType.TIMESHEET;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: WorkflowRegistry,
    private readonly timesheets: TimesheetsService,
  ) {}

  getContext(_tenantId: string, _entityId: string): Promise<WorkflowEntityContext | null> {
    throw new NotImplementedException();
  }

  describe(_tenantId: string, _entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    throw new NotImplementedException();
  }

  approve(_actor: AuthenticatedUser, _entityId: string, _note?: string | null): Promise<unknown> {
    throw new NotImplementedException();
  }

  reject(_actor: AuthenticatedUser, _entityId: string, _note?: string | null): Promise<unknown> {
    throw new NotImplementedException();
  }
}
