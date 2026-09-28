import { api } from '@/lib/api';

export interface PollOption {
  id: string;
  order: number;
  label: string;
  voteCount: number | null;
}

export interface Poll {
  id: string;
  question: string;
  status: 'ACTIVE' | 'CLOSED';
  closesAt: string | null;
  closedAt?: string | null;
  createdAt: string;
  hasVoted?: boolean;
  totalVotes: number | null;
  options: PollOption[];
}

export interface CreatePollPayload {
  question: string;
  options: string[];
  closesAt?: string;
}

export interface ListPollsParams {
  page?: number;
  limit?: number;
}

export interface PollsListPage {
  data: Poll[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** Anonymous, single-choice, whole-tenant polls. */
export const pollsApi = {
  /** Up to 3 rendered by PollWidget; the full list is HR/SUPER's job. */
  active: () => api.get<Poll[]>('/engagement/polls/active'),

  list: (params?: ListPollsParams) => api.get<PollsListPage>('/engagement/polls', { params }),

  create: (data: CreatePollPayload) => api.post<Poll>('/engagement/polls', data),

  vote: (id: string, optionId: string) =>
    api.post<{ success: boolean }>(`/engagement/polls/${id}/vote`, { optionId }),

  close: (id: string) => api.post<{ success: boolean }>(`/engagement/polls/${id}/close`),

  remove: (id: string) => api.delete<{ success: boolean }>(`/engagement/polls/${id}`),
};
