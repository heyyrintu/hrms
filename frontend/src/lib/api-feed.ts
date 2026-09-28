import { api } from '@/lib/api';

export type FeedReactionKind = 'LIKE' | 'CELEBRATE';

export interface FeedPerson {
  id: string;
  firstName: string;
  lastName: string;
  profilePhoto?: string | null;
}

export interface FeedReactionCounts {
  LIKE: number;
  CELEBRATE: number;
}

export interface FeedItem {
  id: string;
  type: 'RECOGNITION' | 'ANNOUNCEMENT' | 'BIRTHDAY' | 'WORK_ANNIVERSARY';
  sourceType: string;
  sourceId: string | null;
  title: string;
  body?: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  actor: FeedPerson | null;
  subject: FeedPerson | null;
  reactionCounts: FeedReactionCounts;
  myReactions: FeedReactionKind[];
}

export interface FeedPage {
  items: FeedItem[];
  nextCursor: string | null;
}

export interface ToggleReactionResult {
  reactionCounts: FeedReactionCounts;
  myReactions: FeedReactionKind[];
}

/**
 * The social feed: reads, reactions and (HR) hiding. Writes for producers
 * (recognition, announcements, celebrations) live server-side only.
 */
export const feedApi = {
  list: (cursor?: string, limit?: number) =>
    api.get<FeedPage>('/engagement/feed', { params: { cursor, limit } }),

  react: (id: string, kind: FeedReactionKind) =>
    api.post<ToggleReactionResult>(`/engagement/feed/${id}/reactions`, { kind }),

  hide: (id: string) => api.post<{ success: boolean }>(`/engagement/feed/${id}/hide`),
};
