import { SetMetadata } from '@nestjs/common';

export const AUDIT_ENTITY_KEY = 'audit_entity';

export interface AuditMetadata {
  entityType: string;
}

/**
 * Decorator to mark a controller method for automatic audit logging.
 * Usage: @Audit('Employee'), @Audit('Department')
 * The interceptor will detect the HTTP method to determine the action (CREATE/UPDATE/DELETE).
 */
export const Audit = (entityType: string) =>
  SetMetadata(AUDIT_ENTITY_KEY, { entityType } as AuditMetadata);
