import { api } from '@/lib/api';

export type OneOnOneStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
export type OneOnOneRole = 'MANAGER' | 'REPORT';

export interface CounterpartSummary {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string | null;
}

export interface Counterpart extends CounterpartSummary {
  relation: 'MANAGER' | 'REPORT';
}

export interface OneOnOne {
  id: string;
  managerId: string;
  employeeId: string;
  scheduledAt: string;
  status: OneOnOneStatus;
  agenda?: string | null;
  sharedNotes?: string | null;
  createdById: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  myRole: OneOnOneRole;
  counterpart: CounterpartSummary | null;
}

export interface ActionItem {
  id: string;
  tenantId: string;
  meetingId: string;
  text: string;
  assigneeId: string;
  isDone: boolean;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OneOnOneDetail extends OneOnOne {
  actionItems: ActionItem[];
  myPrivateNote: string | null;
}

export interface CreateOneOnOnePayload {
  counterpartId: string;
  scheduledAt: string;
  agenda?: string;
}

export interface UpdateOneOnOnePayload {
  scheduledAt?: string;
  agenda?: string;
  sharedNotes?: string;
  status?: OneOnOneStatus;
}

export interface AddActionItemPayload {
  text: string;
  assigneeId: string;
  dueDate?: string;
}

export interface UpdateActionItemPayload {
  text?: string;
  isDone?: boolean;
  dueDate?: string | null;
}

export interface ListOneOnOnesParams {
  counterpartId?: string;
  status?: OneOnOneStatus;
}

/**
 * One-on-one meetings between a manager and a report.
 *
 * Lives beside `@/lib/api` rather than inside it so this feature owns its own
 * surface; every call still goes through the shared axios instance and
 * therefore the shared auth interceptor.
 */
export const oneOnOnesApi = {
  /** My one-on-ones, newest scheduled first. */
  list: (params?: ListOneOnOnesParams) => api.get('/engagement/one-on-ones', { params }),

  /** Schedule a one-on-one with my manager or a direct report. */
  create: (data: CreateOneOnOnePayload) => api.post('/engagement/one-on-ones', data),

  /**
   * Declared before `:id` on the backend, so this hits its own route rather
   * than `/engagement/one-on-ones/:id`.
   */
  counterparts: () => api.get('/engagement/one-on-ones/counterparts'),

  /** Undone action items across all meetings with one counterpart. */
  openItems: (counterpartId: string) =>
    api.get('/engagement/one-on-ones/open-items', { params: { counterpartId } }),

  get: (id: string) => api.get(`/engagement/one-on-ones/${id}`),

  update: (id: string, data: UpdateOneOnOnePayload) =>
    api.patch(`/engagement/one-on-ones/${id}`, data),

  addItem: (id: string, data: AddActionItemPayload) =>
    api.post(`/engagement/one-on-ones/${id}/action-items`, data),

  updateItem: (id: string, itemId: string, data: UpdateActionItemPayload) =>
    api.patch(`/engagement/one-on-ones/${id}/action-items/${itemId}`, data),

  removeItem: (id: string, itemId: string) =>
    api.delete(`/engagement/one-on-ones/${id}/action-items/${itemId}`),

  /** Only I can ever read this back. Empty content deletes the note. */
  savePrivateNote: (id: string, content: string) =>
    api.put(`/engagement/one-on-ones/${id}/private-note`, { content }),
};
