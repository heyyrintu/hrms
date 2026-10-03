/**
 * Feed item contract shared by every producer (recognition, announcements,
 * celebrations, later waves). Frozen after the Wave E scaffold; Wave F adds
 * 'GOAL_COMPLETED' to FEED_ITEM_TYPES.
 */
export const FEED_ITEM_TYPES = ['RECOGNITION', 'ANNOUNCEMENT', 'BIRTHDAY', 'WORK_ANNIVERSARY', 'GOAL_COMPLETED'] as const;
export type FeedItemType = (typeof FEED_ITEM_TYPES)[number];

/** `FeedItem.sourceType` values used by Wave E producers. */
export const FEED_SOURCE = {
  RECOGNITION: 'Recognition',
  ANNOUNCEMENT: 'Announcement',
  EMPLOYEE: 'Employee',
  GOAL: 'Goal',
} as const;

export interface PostFeedItemInput {
  tenantId: string;
  type: FeedItemType;
  sourceType: string;
  sourceId?: string | null;
  /** Who did it (giver, author). Plain id, no FK. */
  actorEmployeeId?: string | null;
  /** Who it is about (birthday person). Plain id, no FK. */
  subjectEmployeeId?: string | null;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  /** Idempotency key, unique per tenant. */
  dedupeKey: string;
  /** Defaults to now. */
  occurredAt?: Date;
  /** When set, the item drops off the feed once this time has passed. */
  expiresAt?: Date | null;
}
