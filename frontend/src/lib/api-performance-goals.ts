import { api } from '@/lib/api';

export type GoalOwnerType = 'COMPANY' | 'DEPARTMENT' | 'EMPLOYEE';
export type GoalStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type KeyResultMetricType = 'NUMBER' | 'PERCENT' | 'CURRENCY' | 'BOOLEAN';
export interface KeyResult { id: string; goalId: string; title: string; metricType: KeyResultMetricType;
  startValue: number; targetValue: number; currentValue: number; unit: string | null;
  weight: number; progress: number; sortOrder: number }
export interface GoalPerson { id: string; firstName: string; lastName: string }
export interface Goal { id: string; ownerType: GoalOwnerType; title: string; description: string | null;
  targetDate: string; status: GoalStatus; progress: number; weight: number; shareOnFeed: boolean;
  completedAt: string | null; reviewId: string | null; parentGoalId: string | null;
  employeeId: string | null; departmentId: string | null;
  employee?: GoalPerson | null; department?: { id: string; name: string } | null;
  keyResults: KeyResult[]; isDerived: boolean; canEdit: boolean }
export interface GoalDetail extends Goal { parent: Goal | null; children: Goal[] }
export interface GoalTreeNode extends Goal { children: GoalTreeNode[] }
export type GoalScope = 'mine' | 'team' | 'company' | 'department';
export interface GoalInput { ownerType?: GoalOwnerType; title: string; description?: string; targetDate: string;
  weight?: number; reviewId?: string | null; parentGoalId?: string | null; departmentId?: string;
  shareOnFeed?: boolean; status?: GoalStatus; progress?: number }
export interface KeyResultInput { title: string; metricType?: KeyResultMetricType; startValue?: number;
  targetValue: number; currentValue?: number; unit?: string; weight?: number; sortOrder?: number }
export const goalsApi = {
  list: (params: { scope: GoalScope; departmentId?: string }) => api.get<Goal[]>('/performance/goals', { params }),
  tree: (rootId?: string) => api.get<GoalTreeNode[]>('/performance/goals/tree', { params: rootId ? { rootId } : {} }),
  get: (id: string) => api.get<GoalDetail>(`/performance/goals/${id}`),
  create: (data: GoalInput) => api.post<Goal>('/performance/goals', data),
  update: (id: string, data: Partial<GoalInput>) => api.put<Goal>(`/performance/goals/${id}`, data),
  remove: (id: string) => api.delete(`/performance/goals/${id}`),
  addKeyResult: (goalId: string, data: KeyResultInput) => api.post<KeyResult>(`/performance/goals/${goalId}/key-results`, data),
  updateKeyResult: (goalId: string, krId: string, data: Partial<KeyResultInput>) =>
    api.put<KeyResult>(`/performance/goals/${goalId}/key-results/${krId}`, data),
  removeKeyResult: (goalId: string, krId: string) => api.delete(`/performance/goals/${goalId}/key-results/${krId}`),
};
