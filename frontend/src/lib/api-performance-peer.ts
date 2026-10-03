import { api } from '@/lib/api';
import type { AnswerInput, CycleQuestion, ReviewAnswer } from './api-performance-reviews';

export type PeerStatus = 'NOMINATED' | 'APPROVED' | 'REJECTED' | 'SUBMITTED' | 'DECLINED';
export interface PeerRow { id: string; status: PeerStatus; closed: boolean;
  peer: { id: string; firstName: string; lastName: string };
  nominatedBy?: { id: string; firstName: string; lastName: string } | null;   // reviewer/admin only
  submittedAt?: string | null; overallComment?: string | null; answers?: ReviewAnswer[] }  // reviewer/admin only
export interface PeerRequest { id: string; status: PeerStatus; closed: boolean;
  reviewee: { id: string; firstName: string; lastName: string }; cycle: { id: string; name: string };
  questions: CycleQuestion[]; answers: ReviewAnswer[]; overallComment: string | null }
export const peerApi = {
  listForReview: (reviewId: string) => api.get<PeerRow[]>(`/performance/reviews/${reviewId}/peers`),
  add: (reviewId: string, peerEmployeeId: string) => api.post<PeerRow>(`/performance/reviews/${reviewId}/peers`, { peerEmployeeId }),
  withdraw: (reviewId: string, peerReviewId: string) => api.delete(`/performance/reviews/${reviewId}/peers/${peerReviewId}`),
  decide: (reviewId: string, peerReviewId: string, approve: boolean) =>
    api.post<PeerRow>(`/performance/reviews/${reviewId}/peers/${peerReviewId}/decision`, { approve }),
  myRequests: () => api.get<PeerRequest[]>('/performance/peer-requests'),
  getRequest: (id: string) => api.get<PeerRequest>(`/performance/peer-requests/${id}`),
  submit: (id: string, data: { answers: AnswerInput[]; overallComment: string }) =>
    api.post<PeerRequest>(`/performance/peer-requests/${id}/submit`, data),
  decline: (id: string) => api.post<PeerRequest>(`/performance/peer-requests/${id}/decline`),
};
