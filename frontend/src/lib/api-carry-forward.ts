import { api } from '@/lib/api';

export interface CarryForwardRun {
  id: string;
  fromYear: number;
  toYear: number;
  triggerType: string;
  status: string;
  processedCount: number;
  failedCount: number;
  startedAt: string;
  completedAt: string | null;
}

export interface CarryForwardRunResult {
  runId: string;
  processedCount: number;
  failedCount: number;
  alreadyRan: boolean;
}

export const carryForwardApi = {
  /** Year-end carry-forward run history, newest year first. */
  getRuns: () => api.get<CarryForwardRun[]>('/leave/carry-forward/runs'),
  /** Carries fromYear leftovers into fromYear + 1. Idempotent per year. */
  run: (fromYear: number) =>
    api.post<CarryForwardRunResult>('/leave/carry-forward/run', { fromYear }),
};
