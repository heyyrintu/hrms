import { api } from '@/lib/api';

/**
 * Shift roster and rotation patterns (Keka wave G). Frozen contract: types and
 * function signatures mirror `backend/src/modules/roster`.
 */

export interface RotationPattern {
  id: string;
  name: string;
  description: string | null;
  cycleLength: number;
  isActive: boolean;
  days: { dayIndex: number; shiftId: string | null }[];
}

export interface RotationPatternInput {
  name: string;
  description?: string;
  days: (string | null)[];
}

export interface RosterCell {
  date: string;
  shiftId: string | null;
  shiftCode: string | null;
  shiftName: string | null;
  isOvernight: boolean;
  isOff: boolean;
  source: 'ROSTER' | 'ASSIGNMENT' | 'NONE';
}

export interface RosterRow {
  employee: { id: string; name: string; code: string; department: string | null };
  cells: RosterCell[];
}

export interface RosterGrid {
  days: string[];
  rows: RosterRow[];
}

export interface ApplyPatternInput {
  patternId: string;
  employeeIds: string[];
  startDate: string;
  endDate: string;
  cycleOffset?: number;
  overwriteManual?: boolean;
}

export interface CellUpdate {
  employeeId: string;
  date: string;
  shiftId?: string | null;
  isOff?: boolean;
  clear?: boolean;
}

export const rosterApi = {
  listPatterns: () => api.get<RotationPattern[]>('/roster/patterns'),
  createPattern: (input: RotationPatternInput) =>
    api.post<RotationPattern>('/roster/patterns', input),
  updatePattern: (id: string, input: RotationPatternInput) =>
    api.put<RotationPattern>(`/roster/patterns/${id}`, input),
  deletePattern: (id: string) => api.delete<void>(`/roster/patterns/${id}`),
  apply: (input: ApplyPatternInput) =>
    api.post<{ created: number; updated: number; skippedManual: number }>('/roster/apply', input),
  getGrid: (params: { from: string; to: string; departmentId?: string; employeeIds?: string }) =>
    api.get<RosterGrid>('/roster', { params }),
  updateCells: (cells: CellUpdate[]) => api.put<RosterRow[]>('/roster/cells', { cells }),
  getMine: (params: { from: string; to: string }) =>
    api.get<RosterCell[]>('/roster/me', { params }),
};
