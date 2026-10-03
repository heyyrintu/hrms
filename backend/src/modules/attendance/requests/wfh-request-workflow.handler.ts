import { Injectable, OnModuleInit } from '@nestjs/common';
import { AttendanceRequestType, WorkflowEntityType } from '@prisma/client';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { WorkflowRegistry } from '../../workflow/workflow-registry.service';
import {
  WorkflowEntityContext,
  WorkflowEntityHandler,
  WorkflowEntitySummary,
} from '../../workflow/workflow.types';
import { AttendanceRequestsService } from './attendance-requests.service';

/** Connects work-from-home requests to the approval engine (Keka wave G, WS-A). */
@Injectable()
export class WfhRequestWorkflowHandler implements WorkflowEntityHandler, OnModuleInit {
  readonly entityType = WorkflowEntityType.WFH_REQUEST;

  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly requests: AttendanceRequestsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  getContext(tenantId: string, entityId: string): Promise<WorkflowEntityContext | null> {
    return this.requests.getContext(tenantId, entityId, AttendanceRequestType.WFH);
  }

  describe(tenantId: string, entityIds: string[]): Promise<WorkflowEntitySummary[]> {
    return this.requests.describe(tenantId, entityIds, AttendanceRequestType.WFH);
  }

  approve(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.requests.approve(actor, entityId, note);
  }

  reject(actor: AuthenticatedUser, entityId: string, note?: string | null) {
    return this.requests.reject(actor, entityId, note);
  }
}
