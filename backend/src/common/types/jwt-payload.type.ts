import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string; // user id
  email: string;
  tenantId: string;
  role: UserRole;
  employeeId?: string;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  tenantId: string;
  role: UserRole;
  employeeId?: string;
}
