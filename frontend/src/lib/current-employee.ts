import type { User } from '@/types';

/**
 * The logged-in user's employee id. The stored user (`hrms_user`, from the
 * login response) carries it nested as `user.employee.id`; there is no
 * reliable top-level `employeeId`. Returns undefined for a user with no
 * linked employee record (e.g. a bare SUPER_ADMIN).
 */
export function currentEmployeeId(
  user: Pick<User, 'employeeId' | 'employee'> | null | undefined,
): string | undefined {
  return user?.employeeId ?? user?.employee?.id ?? undefined;
}
