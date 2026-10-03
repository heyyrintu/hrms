import type { AttendanceRequestType } from '@prisma/client';

/** The approved request covering an employee's day, or null. */
export interface CoveringRequest {
  id: string;
  type: AttendanceRequestType;
}

/** `Upload.entityType` of an attendance selfie. */
export const ATTENDANCE_SELFIE_ENTITY = 'attendance-selfie';

/** A selfie upload older than this cannot be claimed by a punch. */
export const SELFIE_MAX_AGE_MS = 10 * 60 * 1000;
