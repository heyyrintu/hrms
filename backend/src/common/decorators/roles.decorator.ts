import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify which roles can access a route
 * Usage: @Roles(UserRole.HR_ADMIN, UserRole.MANAGER)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
