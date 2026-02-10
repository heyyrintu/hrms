import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import { AUDIT_ENTITY_KEY, AuditMetadata } from './audit.decorator';
import { AuditAction } from '@prisma/client';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMeta = this.reflector.get<AuditMetadata>(
      AUDIT_ENTITY_KEY,
      context.getHandler(),
    );

    // If no @Audit() decorator, skip
    if (!auditMeta) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const user = request.user;

    // Determine action from HTTP method
    let action: AuditAction;
    switch (method) {
      case 'POST':
        action = AuditAction.CREATE;
        break;
      case 'PUT':
      case 'PATCH':
        action = AuditAction.UPDATE;
        break;
      case 'DELETE':
        action = AuditAction.DELETE;
        break;
      default:
        return next.handle(); // Don't audit GET requests
    }

    const entityId = request.params?.id;
    const newValues = method !== 'DELETE' ? request.body : undefined;

    return next.handle().pipe(
      tap((responseData) => {
        // Fire-and-forget audit log
        if (user?.tenantId) {
          this.auditService
            .log({
              tenantId: user.tenantId,
              userId: user.userId,
              action,
              entityType: auditMeta.entityType,
              entityId: entityId || responseData?.id,
              newValues: newValues,
              ipAddress: request.ip || request.headers['x-forwarded-for'],
              userAgent: request.headers['user-agent'],
            })
            .catch(() => {});
        }
      }),
    );
  }
}
