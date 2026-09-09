import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  tenantId: string;
  role: UserRole;
  employeeId?: string;
  /**
   * Session generation this token belongs to. Compared against the user's
   * current tokenVersion on every request, so a password change or forced
   * sign-out invalidates tokens already in circulation. Optional so tokens
   * issued before this field existed still validate.
   */
  tokenVersion?: number;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
  employeeId?: string;
}
