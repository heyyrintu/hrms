import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/types/jwt-payload.type';

/** HR/Super, or a custom role holding `projects.manage`. */
export function isProjectAdmin(actor: AuthenticatedUser): boolean {
  return (
    actor.role === UserRole.SUPER_ADMIN ||
    actor.role === UserRole.HR_ADMIN ||
    (actor.permissions ?? []).includes('projects.manage')
  );
}

/** A project admin, or the employee set as this project's manager. */
export function canManageProject(
  actor: AuthenticatedUser,
  project: { managerEmployeeId: string | null },
): boolean {
  if (isProjectAdmin(actor)) return true;
  return !!actor.employeeId && project.managerEmployeeId === actor.employeeId;
}
