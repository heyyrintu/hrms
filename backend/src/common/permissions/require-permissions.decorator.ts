import { SetMetadata } from '@nestjs/common';
import { Permission } from './permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Lets a custom-role holder through a route in addition to the fixed roles
 * named by @Roles. Any one of the listed permissions is enough. Put it at the
 * same level (class or method) as the @Roles it sits beside.
 *
 * Usage: @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN) @RequirePermissions('org.manage')
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
