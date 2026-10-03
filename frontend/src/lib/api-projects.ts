import { api } from '@/lib/api';

/**
 * Projects, members and tasks (Keka wave G). Frozen contract: types and
 * function signatures mirror `backend/src/modules/projects`.
 */

export type Paginated<T> = {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
};

export type ProjectStatus = 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED';

export interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  description: string | null;
  billable: boolean;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  managerEmployeeId: string | null;
  manager: { id: string; name: string } | null;
  memberCount: number;
  taskCount: number;
  canManage: boolean;
}

export interface ProjectInput {
  code: string;
  name: string;
  clientName?: string;
  description?: string;
  billable?: boolean;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  managerEmployeeId?: string | null;
}

export interface ProjectMember {
  id: string;
  employeeId: string;
  role: string | null;
  startDate: string;
  endDate: string | null;
  employee: { id: string; name: string; code: string };
}

export interface ProjectTask {
  id: string;
  name: string;
  description: string | null;
  billable: boolean | null;
  effectiveBillable: boolean;
  status: 'OPEN' | 'CLOSED';
  estimateHours: number | null;
}

export interface LoggableProject {
  id: string;
  code: string;
  name: string;
  billable: boolean;
  member: { startDate: string; endDate: string | null };
  tasks: { id: string; name: string; billable: boolean | null; effectiveBillable: boolean }[];
}

export const projectsApi = {
  list: (params?: { status?: ProjectStatus; search?: string; page?: number; limit?: number }) =>
    api.get<Paginated<Project>>('/projects', { params }),
  loggable: (weekStart: string) =>
    api.get<LoggableProject[]>('/projects/loggable', { params: { weekStart } }),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (input: ProjectInput) => api.post<Project>('/projects', input),
  update: (id: string, input: Partial<ProjectInput>) => api.put<Project>(`/projects/${id}`, input),
  listMembers: (id: string) => api.get<ProjectMember[]>(`/projects/${id}/members`),
  addMember: (
    id: string,
    input: { employeeId: string; role?: string; startDate?: string; endDate?: string | null },
  ) => api.post<ProjectMember>(`/projects/${id}/members`, input),
  updateMember: (
    id: string,
    memberId: string,
    input: { role?: string | null; startDate?: string; endDate?: string | null },
  ) => api.put<ProjectMember>(`/projects/${id}/members/${memberId}`, input),
  removeMember: (id: string, memberId: string) =>
    api.delete<{ ended: boolean }>(`/projects/${id}/members/${memberId}`),
  listTasks: (id: string) => api.get<ProjectTask[]>(`/projects/${id}/tasks`),
  createTask: (
    id: string,
    input: {
      name: string;
      description?: string;
      billable?: boolean | null;
      estimateHours?: number | null;
    },
  ) => api.post<ProjectTask>(`/projects/${id}/tasks`, input),
  updateTask: (
    id: string,
    taskId: string,
    input: {
      name?: string;
      description?: string | null;
      billable?: boolean | null;
      estimateHours?: number | null;
      status?: 'OPEN' | 'CLOSED';
    },
  ) => api.put<ProjectTask>(`/projects/${id}/tasks/${taskId}`, input),
  deleteTask: (id: string, taskId: string) => api.delete<void>(`/projects/${id}/tasks/${taskId}`),
};
