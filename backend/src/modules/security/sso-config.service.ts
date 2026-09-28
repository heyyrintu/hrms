import { Injectable, NotImplementedException } from '@nestjs/common';
import { SsoProviderView } from '../auth/auth.types';

/**
 * Per-tenant Google / Microsoft OIDC configuration. The client secret is
 * stored encrypted and never returned. Owned by WS-3 (plan Task 3.1).
 */
@Injectable()
export class SsoConfigService {
  listViews(_tenantId: string): Promise<SsoProviderView[]> {
    throw new NotImplementedException();
  }

  hasEnabledProvider(_tenantId: string): Promise<boolean> {
    throw new NotImplementedException();
  }
}
