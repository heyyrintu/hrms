import { api } from '@/lib/api';

/** Mirrors the backend `AttendancePolicy` row. */
export interface AttendancePolicy {
  id: string;
  tenantId: string;
  /** "HH:mm", used when the employee has no shift assignment. */
  defaultShiftStart: string;
  defaultGraceMinutes: number;
  /** null disables the half-day penalty entirely. */
  lateMarksPerHalfDay: number | null;
  autoMarkAbsent: boolean;
  absentIsLop: boolean;
  minHalfDayMinutes: number;
  minFullDayMinutes: number;
  createdAt?: string;
  updatedAt?: string;
}

export type AttendancePolicyUpdate = Partial<
  Omit<AttendancePolicy, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>
>;

export interface MarkAbsentResult {
  marked: number;
  skipped: number;
}

export const attendancePolicyApi = {
  get: () => api.get<AttendancePolicy>('/attendance/policy'),
  update: (data: AttendancePolicyUpdate) =>
    api.put<AttendancePolicy>('/attendance/policy', data),
  /** Sweep one past day for absentees. `date` is YYYY-MM-DD. */
  markAbsent: (date: string) =>
    api.post<MarkAbsentResult>('/attendance/mark-absent', { date }),
};
