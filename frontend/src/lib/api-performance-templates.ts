import { api } from '@/lib/api';
import type { ReviewAudience, ReviewQuestionType } from './api-performance-reviews';

export interface BankQuestion { id: string; text: string; type: ReviewQuestionType; category: string | null; isActive: boolean; usedByTemplates: number }
export interface TemplateEntry { questionId: string; audience: ReviewAudience; isRequired: boolean; sortOrder: number;
  question?: { id: string; text: string; type: ReviewQuestionType; isActive: boolean } }
export interface ReviewTemplate { id: string; name: string; description: string | null; isActive: boolean; questions: TemplateEntry[] }
export interface QuestionInput { text: string; type: ReviewQuestionType; category?: string; isActive?: boolean }
export interface TemplateInput { name: string; description?: string; isActive?: boolean;
  questions: Array<{ questionId: string; audience: ReviewAudience; isRequired?: boolean; sortOrder?: number }> }
export const templatesApi = {
  listQuestions: () => api.get<BankQuestion[]>('/performance/questions'),
  createQuestion: (d: QuestionInput) => api.post<BankQuestion>('/performance/questions', d),
  updateQuestion: (id: string, d: Partial<QuestionInput>) => api.put<BankQuestion>(`/performance/questions/${id}`, d),
  removeQuestion: (id: string) => api.delete(`/performance/questions/${id}`),
  list: () => api.get<ReviewTemplate[]>('/performance/templates'),
  get: (id: string) => api.get<ReviewTemplate>(`/performance/templates/${id}`),
  create: (d: TemplateInput) => api.post<ReviewTemplate>('/performance/templates', d),
  update: (id: string, d: Partial<TemplateInput>) => api.put<ReviewTemplate>(`/performance/templates/${id}`, d),
  remove: (id: string) => api.delete(`/performance/templates/${id}`),
};
