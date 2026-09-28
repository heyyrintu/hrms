import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../permissions/require-permissions.decorator';
import { AuthenticatedUser } from '../types/jwt-payload.type';

/**
 * Checks the fixed role against @Roles and, on routes that opt in with
 * @RequirePermissions, the permissions granted by the user's custom roles.
 * A route with only @Roles behaves exactly as it did before custom roles.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets);
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      targets,
    );
    const hasRoles = !!requiredRoles && requiredRoles.length > 0;
    const hasPermissions = !!requiredPermissions && requiredPermissions.length > 0;

    // If nothing is required, allow access
    if (!hasRoles && !hasPermissions) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthenticatedUser;

    if (!user) {
      return false;
    }

    // SUPER_ADMIN has access to everything
    if (user.role === UserRole.SUPER_ADMIN) {
      return true;
    }

    if (hasRoles && requiredRoles.includes(user.role)) {
      return true;
    }

    // Custom roles only widen access on routes that opt in.
    if (hasPermissions) {
      const held = user.permissions ?? [];
      return requiredPermissions.some((p) => held.includes(p));
    }

    return false;
  }
}
