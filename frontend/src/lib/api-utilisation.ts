import { api } from '@/lib/api';

/**
 * Utilisation report against capacity (Keka wave G). Frozen contract: types and
 * function signatures mirror `backend/src/modules/timesheets/utilisation*`.
 */

export type UtilisationGroupBy = 'employee' | 'project';

export interface UtilisationQuery {
  from: string;
  to: string;
  groupBy: UtilisationGroupBy;
  departmentId?: string;
  projectId?: string;
  employeeId?: string;
  includeSubmitted?: boolean;
}

export interface EmployeeUtilisationRow {
  employeeId: string;
  name: string;
  code: string;
  department: string | null;
  capacityHours: number;
  loggedHours: number;
  billableHours: number;
  utilisationPct: number | null;
  billablePct: number | null;
}

export interface ProjectUtilisationRow {
  projectId: string;
  code: string;
  name: string;
  loggedHours: number;
  billableHours: number;
  billableSharePct: number | null;
  contributors: number;
}

export interface UtilisationReport {
  query: UtilisationQuery;
  generatedAt: string;
  rows: EmployeeUtilisationRow[] | ProjectUtilisationRow[];
  totals:
    | Omit<EmployeeUtilisationRow, 'employeeId' | 'name' | 'code' | 'department'>
    | Omit<ProjectUtilisationRow, 'projectId' | 'code' | 'name'>;
}

export const utilisationApi = {
  get: (query: UtilisationQuery) => api.get<UtilisationReport>('/utilisation', { params: query }),
  exportCsv: (query: UtilisationQuery) =>
    api.get<Blob>('/utilisation/export', { params: query, responseType: 'blob' }),
};
