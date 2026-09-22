import { api } from '@/lib/api';

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type TicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_ON_EMPLOYEE'
  | 'RESOLVED'
  | 'CLOSED';

export interface TicketCategory {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  slaHours: number;
  isActive: boolean;
}

export interface TicketPerson {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string | null;
}

export interface TicketAssignee {
  id: string;
  email: string;
  employeeId?: string | null;
}

export interface TicketComment {
  id: string;
  content: string;
  isInternal: boolean;
  authorId: string;
  createdAt: string;
  author?: TicketAssignee;
}

export interface Ticket {
  id: string;
  ticketNumber: number;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  categoryId: string;
  employeeId: string;
  assignedToId?: string | null;
  slaDeadline: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  employee?: TicketPerson;
  category?: Pick<TicketCategory, 'id' | 'name' | 'code' | 'slaHours'>;
  assignedTo?: TicketAssignee | null;
}

/** `GET /helpdesk/tickets/:id` adds the thread and what the caller may do next. */
export interface TicketDetail extends Ticket {
  comments: TicketComment[];
  actor: 'HR' | 'ASSIGNEE' | 'OWNER';
  allowedStatuses: TicketStatus[];
}

export interface HelpdeskStats {
  byStatus: Record<TicketStatus, number>;
  overdue: number;
  avgResolutionHours: number | null;
}

/** Someone a ticket can be handed to. `id` is a User id, not an Employee id. */
export interface HelpdeskAgent {
  id: string;
  email: string;
  employeeId?: string | null;
  name: string;
}

export interface TicketListParams {
  status?: TicketStatus;
  priority?: TicketPriority;
  assignedToId?: string;
  categoryId?: string;
  overdue?: boolean;
  page?: number;
  limit?: number;
}

export interface CategoryPayload {
  name?: string;
  code?: string;
  description?: string;
  slaHours?: number;
  isActive?: boolean;
}

export interface CreateTicketPayload {
  categoryId: string;
  subject: string;
  description: string;
  priority?: TicketPriority;
}

export const helpdeskApi = {
  // Categories
  getCategories: (includeInactive = false) =>
    api.get<TicketCategory[]>('/helpdesk/categories', {
      params: includeInactive ? { includeInactive: 'true' } : undefined,
    }),
  createCategory: (payload: CategoryPayload) =>
    api.post<TicketCategory>('/helpdesk/categories', payload),
  updateCategory: (id: string, payload: CategoryPayload) =>
    api.put<TicketCategory>(`/helpdesk/categories/${id}`, payload),

  // Tickets
  createTicket: (payload: CreateTicketPayload) =>
    api.post<Ticket>('/helpdesk/tickets', payload),
  getMyTickets: (params?: TicketListParams) =>
    api.get('/helpdesk/tickets/my', { params }),
  getTickets: (params?: TicketListParams) =>
    api.get('/helpdesk/tickets', { params }),
  getTicket: (id: string) => api.get<TicketDetail>(`/helpdesk/tickets/${id}`),
  assign: (id: string, assignedToId: string) =>
    api.post<Ticket>(`/helpdesk/tickets/${id}/assign`, { assignedToId }),
  changeStatus: (id: string, status: TicketStatus) =>
    api.post<Ticket>(`/helpdesk/tickets/${id}/status`, { status }),
  addComment: (id: string, content: string, isInternal = false) =>
    api.post<TicketComment>(`/helpdesk/tickets/${id}/comments`, {
      content,
      isInternal,
    }),

  // Stats and agents
  getStats: () => api.get<HelpdeskStats>('/helpdesk/stats'),
  getAgents: () => api.get<HelpdeskAgent[]>('/helpdesk/agents'),
};

export const statusLabels: Record<TicketStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_ON_EMPLOYEE: 'Waiting on you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export const priorityLabels: Record<TicketPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** A ticket is late only while somebody still owes work on it. */
export const isOverdue = (ticket: Pick<Ticket, 'slaDeadline' | 'status'>) =>
  ticket.status !== 'RESOLVED' &&
  ticket.status !== 'CLOSED' &&
  new Date(ticket.slaDeadline).getTime() < Date.now();
