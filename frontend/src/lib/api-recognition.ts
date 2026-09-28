import { api } from '@/lib/api';

export interface RecognitionEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode?: string;
}

export interface Badge {
  id: string;
  name: string;
  description?: string | null;
  icon: string;
  points: number;
  isActive: boolean;
}

export interface RecognitionRecipient {
  id: string;
  employeeId: string;
  points: number;
  employee?: RecognitionEmployee;
}

export interface Recognition {
  id: string;
  message: string;
  pointsPerRecipient: number;
  createdAt: string;
  giver?: RecognitionEmployee;
  badge?: Badge | null;
  recipients: RecognitionRecipient[];
}

export interface RecognitionWallResponse {
  data: Recognition[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface RecognitionSummary {
  pointsEnabled: boolean;
  allowance: number;
  spentThisMonth: number;
  remainingThisMonth: number;
  receivedPointsTotal: number;
  receivedCountTotal: number;
}

export type LeaderboardPeriod = 'month' | 'quarter' | 'year' | 'all';

export interface LeaderboardRow {
  rank: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  department: string | null;
  points: number;
  count: number;
}

export interface EngagementSettings {
  pointsEnabled: boolean;
  monthlyPointsAllowance: number;
  showBirthdays: boolean;
  showAnniversaries: boolean;
}

export interface GiveRecognitionPayload {
  recipientIds: string[];
  message: string;
  badgeId?: string;
  points?: number;
}

export interface WallParams {
  page?: number;
  limit?: number;
  employeeId?: string;
}

export interface BadgePayload {
  name: string;
  description?: string;
  icon: string;
  points?: number;
}

/**
 * Recognition: badges, kudos, points and the leaderboard. Lives beside
 * `@/lib/api` rather than inside it so the workstream owns its own surface;
 * every call still goes through the shared axios instance and therefore the
 * shared auth interceptor. The Settings tab also lives here, calling the
 * (already-shipped) `/engagement/settings` endpoints.
 */
export const recognitionApi = {
  /** Recognition wall, newest first. */
  wall: (params?: WallParams) => api.get('/engagement/recognition', { params }),

  /** Give recognition to one or more employees. */
  give: (data: GiveRecognitionPayload) => api.post('/engagement/recognition', data),

  /** My own points summary. */
  me: () => api.get('/engagement/recognition/me'),

  /** Top recognised employees for a period. */
  leaderboard: (period: LeaderboardPeriod = 'month') =>
    api.get('/engagement/recognition/leaderboard', { params: { period } }),

  /** Badge catalog. `includeInactive` only has effect for HR/SUPER callers. */
  badges: (includeInactive?: boolean) =>
    api.get('/engagement/recognition/badges', {
      params: includeInactive ? { includeInactive: true } : undefined,
    }),

  createBadge: (data: BadgePayload) => api.post('/engagement/recognition/badges', data),

  updateBadge: (id: string, data: Partial<BadgePayload>) =>
    api.put(`/engagement/recognition/badges/${id}`, data),

  deactivateBadge: (id: string) => api.delete(`/engagement/recognition/badges/${id}`),

  /** Delete a recognition (HR/SUPER). */
  remove: (id: string) => api.delete(`/engagement/recognition/${id}`),

  getSettings: () => api.get('/engagement/settings'),

  updateSettings: (data: Partial<EngagementSettings>) => api.put('/engagement/settings', data),
};
