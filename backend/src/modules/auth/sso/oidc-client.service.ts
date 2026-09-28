import { Injectable } from '@nestjs/common';
import { Issuer, Client } from 'openid-client';
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

const GOOGLE_ISSUER = 'https://accounts.google.com';

function issuerUrl(config: OidcProviderConfig): string {
  if (config.provider === SsoProvider.MICROSOFT) {
    return `https://login.microsoftonline.com/${config.entraTenantId}/v2.0`;
  }
  return GOOGLE_ISSUER;
}

/**
 * The only place that touches openid-client, so the SSO flow is testable
 * with a plain mock. Owned by WS-3 (plan Task 3.2).
 */
@Injectable()
export class OidcClientService {
  /** Discovery is one HTTP round trip; cache the result per issuer URL for the life of the process. */
  private readonly issuers = new Map<string, Promise<Issuer<Client>>>();

  private discover(url: string): Promise<Issuer<Client>> {
    let cached = this.issuers.get(url);
    if (!cached) {
      cached = Issuer.discover(url);
      // I3: a rejected discovery must not stay cached forever — evict it so
      // the next call retries instead of replaying the same failure until
      // the process restarts. The rejection itself is still returned to
      // this caller.
      cached.catch(() => this.issuers.delete(url));
      this.issuers.set(url, cached);
    }
    return cached;
  }

  private async client(config: OidcProviderConfig, redirectUri: string): Promise<Client> {
    const issuer = await this.discover(issuerUrl(config));
    return new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
    });
  }

  async authorizationUrl(
    config: OidcProviderConfig,
    params: { state: string; nonce: string; codeChallenge: string; redirectUri: string },
  ): Promise<string> {
    const client = await this.client(config, params.redirectUri);
    return client.authorizationUrl({
      scope: 'openid email profile',
      redirect_uri: params.redirectUri,
      state: params.state,
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    });
  }

  async exchange(
    config: OidcProviderConfig,
    params: {
      callbackParams: Record<string, string>;
      redirectUri: string;
      codeVerifier: string;
      state: string;
      nonce: string;
    },
  ): Promise<IdClaims> {
    const client = await this.client(config, params.redirectUri);
    const tokenSet = await client.callback(params.redirectUri, params.callbackParams, {
      state: params.state,
      nonce: params.nonce,
      code_verifier: params.codeVerifier,
    });
    return tokenSet.claims() as unknown as IdClaims;
  }
}
