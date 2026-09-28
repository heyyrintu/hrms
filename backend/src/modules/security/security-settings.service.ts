import { Injectable, NotImplementedException } from '@nestjs/common';
import { SecuritySettingsView } from '../auth/auth.types';

/**
 * Tenant sign-in policy: SSO-only and per-role 2FA requirement.
 * Owned by WS-2 (plan Task 2.5).
 */
@Injectable()
export class SecuritySettingsService {
  /** Defaults ({ requireSso: false, twoFactorRequiredRoles: [] }) when no row exists. */
  get(_tenantId: string): Promise<SecuritySettingsView> {
    throw new NotImplementedException();
  }
}
