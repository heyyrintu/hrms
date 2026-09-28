import { api } from './api';
import { AuthResponse } from '@/types';
import {
  CustomRoleInput,
  CustomRoleView,
  Paginated,
  PermissionDef,
  SecuritySettings,
  SecuritySettingsResponse,
  SecurityUserRow,
  SsoConfigInput,
  SsoProviderKey,
  SsoProviderView,
  TotpSetup,
  TwoFactorStatus,
} from '@/types/security';

// Keka wave H1 API clients: security admin, two-factor authentication, SSO.

export const securityApi = {
  getPermissions: () => api.get<PermissionDef[]>('/security/permissions'),
  getRoles: () => api.get<CustomRoleView[]>('/security/roles'),
  createRole: (body: CustomRoleInput) => api.post<CustomRoleView>('/security/roles', body),
  updateRole: (id: string, body: Partial<CustomRoleInput>) =>
    api.patch<CustomRoleView>(`/security/roles/${id}`, body),
  deleteRole: (id: string) => api.delete(`/security/roles/${id}`),
  getUsers: (params: { search?: string; page?: number; limit?: number }) =>
    api.get<Paginated<SecurityUserRow>>('/security/users', { params }),
  setUserRoles: (userId: string, customRoleIds: string[]) =>
    api.put(`/security/users/${userId}/roles`, { customRoleIds }),
  resetUserTwoFactor: (userId: string) => api.post(`/security/users/${userId}/2fa/reset`),
  getSettings: () => api.get<SecuritySettingsResponse>('/security/settings'),
  updateSettings: (body: Partial<SecuritySettings>) =>
    api.put<SecuritySettingsResponse>('/security/settings', body),
  upsertSso: (provider: SsoProviderKey, body: SsoConfigInput) =>
    api.put<SsoProviderView>(`/security/sso/${provider.toLowerCase()}`, body),
  deleteSso: (provider: SsoProviderKey) => api.delete(`/security/sso/${provider.toLowerCase()}`),
};

/** A step token (forced enrolment) is sent in place of the session token. */
const bearer = (token?: string) =>
  token ? { headers: { Authorization: `Bearer ${token}` } } : {};

export const twoFactorApi = {
  status: () => api.get<TwoFactorStatus>('/auth/2fa/status'),
  setup: (enrolToken?: string) => api.post<TotpSetup>('/auth/2fa/setup', {}, bearer(enrolToken)),
  enable: (code: string, enrolToken?: string) =>
    api.post<{ recoveryCodes: string[]; session: AuthResponse }>(
      '/auth/2fa/enable',
      { code },
      bearer(enrolToken),
    ),
  verify: (mfaToken: string, code: string) =>
    api.post<AuthResponse>('/auth/2fa/verify', { mfaToken, code }),
  disable: (password: string, code: string) =>
    api.post<AuthResponse>('/auth/2fa/disable', { password, code }),
  regenerateRecoveryCodes: (code: string) =>
    api.post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { code }),
};

export const ssoApi = {
  providers: (org?: string | null) =>
    api.get<{ providers: SsoProviderKey[]; requireSso: boolean }>('/auth/sso/providers', {
      params: org ? { org } : {},
    }),
  /** Full-page navigation target: the API redirects on to Google or Microsoft. */
  startUrl: (provider: SsoProviderKey, org?: string | null) =>
    `${api.defaults.baseURL}/auth/sso/${provider.toLowerCase()}/start${
      org ? `?org=${encodeURIComponent(org)}` : ''
    }`,
  exchange: (code: string) => api.post<AuthResponse>('/auth/sso/exchange', { code }),
};
