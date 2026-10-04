import { api } from '@/lib/api';

export type ReviewQuestionType = 'RATING' | 'TEXT';
export type ReviewAudience = 'SELF' | 'MANAGER' | 'PEER';
export interface CycleQuestion { id: string; text: string; type: ReviewQuestionType; audience: ReviewAudience; isRequired: boolean; sortOrder: number }
export interface ReviewAnswer { cycleQuestionId: string; audience: ReviewAudience; rating: number | null; text: string | null }
export interface CompetencyRating { id: string; name: string; expectedLevel: number; managerRating: number | null; comment: string | null }
export interface AnonymousPeerFeedback { submittedCount: number;
  questions: Array<{ text: string; type: ReviewQuestionType; ratings: number[]; texts: string[] }>; comments: string[] }
export interface ReviewView {
  id: string; cycleId: string; employeeId: string; reviewerId: string; status: string;
  relation: 'SELF' | 'REVIEWER' | 'ADMIN'; released: boolean;
  cycle: { id: string; name: string; startDate: string; endDate: string; status: string; peerFeedbackEnabled: boolean; maxPeers: number };
  employee?: { id: string; employeeCode: string; firstName: string; lastName: string; designation?: { name: string } | null; department?: { name: string } | null };
  reviewer?: { id: string; firstName: string; lastName: string };
  selfRating: number | null; selfComments: string | null; selfSubmittedAt: string | null;
  answers?: ReviewAnswer[];            // SELF answers always; MANAGER answers only when visible
  managerComments?: string | null; managerSubmittedAt?: string | null;
  competencyRatings?: CompetencyRating[];
  finalRating?: number | null;
  managerRating?: number | null; overallRating?: number | null;
  calibratedRating?: number | null; calibrationReason?: string | null; calibratedAt?: string | null;
  potentialRating?: number | null;
  peerFeedback?: AnonymousPeerFeedback | null; peerFeedbackHiddenReason?: 'TOO_FEW_RESPONSES' | 'NOT_RELEASED';
  goals?: unknown[];
}
export interface AnswerInput { cycleQuestionId: string; rating?: number; text?: string }
export interface SelfReviewInput { selfRating: number; selfComments?: string; answers?: AnswerInput[] }
export interface ManagerReviewInput { managerRating: number; managerComments?: string; overallRating: number;
  potentialRating?: number; answers?: AnswerInput[]; competencyRatings?: Array<{ id: string; rating: number; comment?: string }> }
export const reviewsApi = {
  myReviews: (params?: Record<string, string>) => api.get<{ data: ReviewView[]; meta: unknown }>('/performance/my-reviews', { params }),
  teamReviews: (params?: Record<string, string>) => api.get<{ data: ReviewView[]; meta: unknown }>('/performance/team-reviews', { params }),
  get: (id: string) => api.get<ReviewView>(`/performance/reviews/${id}`),
  questions: (id: string) => api.get<CycleQuestion[]>(`/performance/reviews/${id}/questions`),
  submitSelf: (id: string, data: SelfReviewInput) => api.post<ReviewView>(`/performance/reviews/${id}/self-review`, data),
  submitManager: (id: string, data: ManagerReviewInput) => api.post<ReviewView>(`/performance/reviews/${id}/manager-review`, data),
  setPotential: (id: string, potentialRating: number) => api.put<ReviewView>(`/performance/reviews/${id}/potential`, { potentialRating }),
};
