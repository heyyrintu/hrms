import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowEntityType } from '@prisma/client';
import { WorkflowEntityHandler } from './workflow.types';

/**
 * Domain modules register one handler per entity type (in the handler's
 * onModuleInit). The workflow module never imports a domain module, which is
 * what keeps domain → workflow a one-way dependency.
 */
@Injectable()
export class WorkflowRegistry {
  private readonly handlers = new Map<WorkflowEntityType, WorkflowEntityHandler>();

  register(handler: WorkflowEntityHandler): void {
    this.handlers.set(handler.entityType, handler);
  }

  get(entityType: WorkflowEntityType): WorkflowEntityHandler {
    const handler = this.handlers.get(entityType);
    if (!handler) {
      throw new NotFoundException(`No approval handler registered for ${entityType}`);
    }
    return handler;
  }

  find(entityType: WorkflowEntityType): WorkflowEntityHandler | undefined {
    return this.handlers.get(entityType);
  }
}
