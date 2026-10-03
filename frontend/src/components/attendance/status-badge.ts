import { getStatusBadgeVariant } from '@/components/ui';

type Variant = ReturnType<typeof getStatusBadgeVariant>;

/**
 * Badge colour for an attendance status. ON_DUTY gets the same colour as WFH
 * (the shared helper predates it and would otherwise show it grey).
 */
export function attendanceStatusVariant(status: string): Variant {
  return status === 'ON_DUTY' ? getStatusBadgeVariant('WFH') : getStatusBadgeVariant(status);
}

/** Human label: `ON_DUTY` reads "ON DUTY". */
export function attendanceStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}
