import { AuthResponse, UserRole } from './index';

// Keka wave H1: custom roles, two-factor authentication, single sign-on.

export type SsoProviderKey = 'GOOGLE' | 'MICROSOFT';

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description: string;
}

export interface CustomRoleView {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRoleInput {
  name: string;
  description?: string;
  permissions: string[];
}

export interface SecurityUserRow {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  employeeName: string | null;
  twoFactorEnabled: boolean;
  customRoles: { id: string; name: string }[];
  ssoProviders: SsoProviderKey[];
}

export interface Paginated<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface SecuritySettings {
  requireSso: boolean;
  twoFactorRequiredRoles: UserRole[];
}

export interface SsoProviderView {
  provider: SsoProviderKey;
  clientId: string;
  hasClientSecret: true;
  entraTenantId: string | null;
  enabled: boolean;
  allowedDomains: string[];
  autoCreateUsers: boolean;
  redirectUri: string;
  updatedAt: string;
}

export interface SecuritySettingsResponse extends SecuritySettings {
  providers: SsoProviderView[];
}

export interface SsoConfigInput {
  clientId: string;
  /** Required when creating; omit on update to keep the stored secret. */
  clientSecret?: string;
  entraTenantId?: string;
  enabled: boolean;
  allowedDomains: string[];
  autoCreateUsers: boolean;
}

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  required: boolean;
  recoveryCodesRemaining: number;
}

export interface TotpSetup {
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/** Password login can finish, or stop at a second-factor step. */
export type LoginResponse =
  | AuthResponse
  | { mfaRequired: true; mfaToken: string }
  | { enrolmentRequired: true; enrolToken: string };

export const SSO_ERROR_CODES = [
  'invalid_state',
  'provider_disabled',
  'idp_error',
  'email_unverified',
  'domain_not_allowed',
  'wrong_directory',
  'identity_conflict',
  'no_account',
  'account_inactive',
] as const;
export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];
