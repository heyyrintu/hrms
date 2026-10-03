import { api } from '@/lib/api';

/**
 * Weekly timesheets (Keka wave G). Frozen contract: types and function
 * signatures mirror `backend/src/modules/timesheets`.
 */

export type Paginated<T> = {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface TimesheetEntry {
  id: string;
  date: string;
  projectId: string;
  taskId: string | null;
  hours: number;
  billable: boolean;
  note: string | null;
  project?: { id: string; code: string; name: string };
  task?: { id: string; name: string } | null;
}

export interface Timesheet {
  id: string;
  employeeId: string;
  weekStart: string;
  status: TimesheetStatus;
  totalHours: number;
  submittedAt: string | null;
  decidedAt: string | null;
  approverNote: string | null;
  employee?: { id: string; name: string; code: string };
  entries?: TimesheetEntry[];
}

export interface MyWeek {
  timesheet: Timesheet | null;
  entries: TimesheetEntry[];
  attendedMinutesByDate: Record<string, number>;
}

export interface EntryInput {
  date: string;
  projectId: string;
  taskId?: string | null;
  hours: number;
  note?: string | null;
}

export const timesheetsApi = {
  getMyWeek: (weekStart: string) => api.get<MyWeek>('/timesheets/me', { params: { weekStart } }),
  listMine: (params?: { from?: string; to?: string }) =>
    api.get<Timesheet[]>('/timesheets/me/list', { params }),
  saveEntries: (weekStart: string, entries: EntryInput[]) =>
    api.put<MyWeek>(`/timesheets/me/${weekStart}/entries`, { entries }),
  submit: (id: string) => api.post<Timesheet>(`/timesheets/${id}/submit`),
  recall: (id: string) => api.post<Timesheet>(`/timesheets/${id}/recall`),
  getPendingApprovals: () => api.get<Timesheet[]>('/timesheets/pending-approvals'),
  getAll: (params?: {
    status?: TimesheetStatus;
    from?: string;
    to?: string;
    employeeId?: string;
    departmentId?: string;
    page?: number;
    limit?: number;
  }) => api.get<Paginated<Timesheet>>('/timesheets/all', { params }),
  get: (id: string) => api.get<Timesheet>(`/timesheets/${id}`),
  approve: (id: string, note?: string) =>
    api.post<Timesheet>(`/timesheets/${id}/approve`, { note }),
  reject: (id: string, note?: string) => api.post<Timesheet>(`/timesheets/${id}/reject`, { note }),
};
