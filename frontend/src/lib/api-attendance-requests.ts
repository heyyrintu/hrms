import { api } from '@/lib/api';

/**
 * WFH and on-duty requests (Keka wave G). Frozen contract: types and function
 * signatures mirror `backend/src/modules/attendance/requests`. Callers unwrap
 * `.data` themselves.
 */

export type Paginated<T> = {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export type AttendanceRequestType = 'WFH' | 'ON_DUTY';
export type AttendanceRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface AttendanceRequest {
  id: string;
  employeeId: string;
  type: AttendanceRequestType;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  location: string | null;
  status: AttendanceRequestStatus;
  approverNote: string | null;
  decidedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  employee?: { id: string; firstName: string; lastName: string; employeeCode: string };
}

export interface CreateAttendanceRequestInput {
  type: AttendanceRequestType;
  fromDate: string;
  toDate: string;
  reason: string;
  location?: string;
}

export const attendanceRequestsApi = {
  create: (input: CreateAttendanceRequestInput) =>
    api.post<AttendanceRequest>('/attendance-requests', input),
  getMine: (params?: { status?: AttendanceRequestStatus; from?: string; to?: string }) =>
    api.get<AttendanceRequest[]>('/attendance-requests/me', { params }),
  getPendingApprovals: () =>
    api.get<AttendanceRequest[]>('/attendance-requests/pending-approvals'),
  getAll: (params?: {
    type?: AttendanceRequestType;
    status?: AttendanceRequestStatus;
    from?: string;
    to?: string;
    employeeId?: string;
    page?: number;
    limit?: number;
  }) => api.get<Paginated<AttendanceRequest>>('/attendance-requests/all', { params }),
  approve: (id: string, note?: string) =>
    api.post<AttendanceRequest>(`/attendance-requests/${id}/approve`, { note }),
  reject: (id: string, note?: string) =>
    api.post<AttendanceRequest>(`/attendance-requests/${id}/reject`, { note }),
  cancel: (id: string) => api.post<AttendanceRequest>(`/attendance-requests/${id}/cancel`),
};
