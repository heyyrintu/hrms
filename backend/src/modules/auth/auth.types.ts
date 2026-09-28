import { SsoProvider, UserRole } from '@prisma/client';

/**
 * Contracts shared by password login, two-factor authentication and SSO
 * (Keka wave H1).
 */

/**
 * Short-lived tokens handed out in the middle of a login. They are signed with
 * JWT_SECRET like a session, so each carries a `typ` claim and the JWT
 * strategy refuses any token that has one. Sessions never carry `typ`.
 */
export type StepTokenType = 'mfa' | 'enrol';

/** Password verified, second factor pending. `cid` is the MfaChallenge id. 5 minutes. */
export interface MfaStepPayload {
  typ: 'mfa';
  sub: string;
  tenantId: string;
  cid: string;
}

/** Password verified, role requires 2FA, user not enrolled yet. 15 minutes. */
export interface EnrolStepPayload {
  typ: 'enrol';
  sub: string;
  tenantId: string;
  tokenVersion: number;
}

export interface SessionUserView {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string;
  employeeId?: string;
  mustChangePassword: boolean;
  permissions: string[];
}

export interface SessionResponse {
  accessToken: string;
  user: SessionUserView;
}

export interface MfaRequiredResponse {
  mfaRequired: true;
  mfaToken: string;
}

export interface EnrolmentRequiredResponse {
  enrolmentRequired: true;
  enrolToken: string;
}

export type LoginResult = SessionResponse | MfaRequiredResponse | EnrolmentRequiredResponse;

export interface SecuritySettingsView {
  requireSso: boolean;
  twoFactorRequiredRoles: UserRole[];
}

/** What the API ever says about an SSO provider config. Never the secret. */
export interface SsoProviderView {
  provider: SsoProvider;
  clientId: string;
  hasClientSecret: true;
  entraTenantId: string | null;
  enabled: boolean;
  allowedDomains: string[];
  autoCreateUsers: boolean;
  redirectUri: string;
  updatedAt: Date;
}
