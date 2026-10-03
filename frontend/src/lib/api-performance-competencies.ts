import { api } from '@/lib/api';

export interface Competency { id: string; name: string; description: string | null; category: string | null; isActive: boolean; mappedDesignations: number }
export interface DesignationCompetency { competencyId: string; expectedLevel: number; competency: { id: string; name: string; isActive: boolean } }
export interface CompetencyInput { name: string; description?: string; category?: string; isActive?: boolean }
export const competenciesApi = {
  list: () => api.get<Competency[]>('/performance/competencies'),
  create: (d: CompetencyInput) => api.post<Competency>('/performance/competencies', d),
  update: (id: string, d: Partial<CompetencyInput>) => api.put<Competency>(`/performance/competencies/${id}`, d),
  remove: (id: string) => api.delete(`/performance/competencies/${id}`),
  forDesignation: (designationId: string) => api.get<DesignationCompetency[]>(`/performance/designations/${designationId}/competencies`),
  setForDesignation: (designationId: string, items: Array<{ competencyId: string; expectedLevel: number }>) =>
    api.put<DesignationCompetency[]>(`/performance/designations/${designationId}/competencies`, { items }),
};
