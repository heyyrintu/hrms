import type { Goal, GoalStatus } from '@/lib/api-performance-goals';

export const STATUS_LABEL: Record<GoalStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
};

export const STATUS_VARIANT: Record<GoalStatus, 'gray' | 'info' | 'success'> = {
  NOT_STARTED: 'gray',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
};

/** Owner chip text: Company, the department name, or the employee's name. */
export function ownerLabel(goal: Goal): string {
  if (goal.ownerType === 'COMPANY') return 'Company';
  if (goal.ownerType === 'DEPARTMENT') return goal.department?.name ?? 'Department';
  return goal.employee ? `${goal.employee.firstName} ${goal.employee.lastName}`.trim() : 'Employee';
}

export function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.split('T')[0] : '';
}

/** Departments API returns a bare array; tolerate a `{ data: [] }` envelope too. */
export function asList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const inner = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(inner) ? (inner as T[]) : [];
}
