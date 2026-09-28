import { Injectable, NotImplementedException } from '@nestjs/common';
import { SsoProvider } from '@prisma/client';

export interface OidcProviderConfig {
  provider: SsoProvider;
  clientId: string;
  clientSecret: string;
  entraTenantId: string | null;
}

export interface IdClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  tid?: string;
}

/**
 * The only place that touches openid-client, so the SSO flow is testable
 * with a plain mock. Owned by WS-3 (plan Task 3.2).
 */
@Injectable()
export class OidcClientService {
  authorizationUrl(
    _config: OidcProviderConfig,
    _params: { state: string; nonce: string; codeChallenge: string; redirectUri: string },
  ): Promise<string> {
    throw new NotImplementedException();
  }

  exchange(
    _config: OidcProviderConfig,
    _params: {
      callbackParams: Record<string, string>;
      redirectUri: string;
      codeVerifier: string;
      state: string;
      nonce: string;
    },
  ): Promise<IdClaims> {
    throw new NotImplementedException();
  }
}
