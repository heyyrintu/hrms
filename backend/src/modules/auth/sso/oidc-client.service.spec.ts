import { SsoProvider } from '@prisma/client';
import { OidcClientService } from './oidc-client.service';

const mockClientInstance = {
  authorizationUrl: jest.fn(),
  callback: jest.fn(),
};

const MockClientCtor = jest.fn().mockImplementation(() => mockClientInstance);

const mockIssuerInstance = { Client: MockClientCtor };

jest.mock('openid-client', () => ({
  Issuer: {
    discover: jest.fn(),
  },
  generators: {
    random: jest.fn(),
    codeVerifier: jest.fn(),
    codeChallenge: jest.fn(),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Issuer } = jest.requireMock('openid-client');

describe('OidcClientService', () => {
  let service: OidcClientService;

  const googleConfig = {
    provider: SsoProvider.GOOGLE,
    clientId: 'google-client-id',
    clientSecret: 'google-secret',
    entraTenantId: null,
  };

  const microsoftConfig = {
    provider: SsoProvider.MICROSOFT,
    clientId: 'ms-client-id',
    clientSecret: 'ms-secret',
    entraTenantId: '11111111-2222-3333-4444-555555555555',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (Issuer.discover as jest.Mock).mockResolvedValue(mockIssuerInstance);
    service = new OidcClientService();
  });

  describe('authorizationUrl', () => {
    it('discovers the Google issuer at the fixed well-known URL', async () => {
      mockClientInstance.authorizationUrl.mockReturnValue('https://accounts.google.com/authorize?x=1');

      const url = await service.authorizationUrl(googleConfig, {
        state: 'state-1',
        nonce: 'nonce-1',
        codeChallenge: 'challenge-1',
        redirectUri: 'https://api.example.com/api/auth/sso/google/callback',
      });

      expect(Issuer.discover).toHaveBeenCalledWith('https://accounts.google.com');
      expect(url).toBe('https://accounts.google.com/authorize?x=1');
    });

    it('discovers the Microsoft issuer scoped to the configured entraTenantId', async () => {
      mockClientInstance.authorizationUrl.mockReturnValue('https://login.microsoftonline.com/authorize?x=1');

      await service.authorizationUrl(microsoftConfig, {
        state: 'state-1',
        nonce: 'nonce-1',
        codeChallenge: 'challenge-1',
        redirectUri: 'https://api.example.com/api/auth/sso/microsoft/callback',
      });

      expect(Issuer.discover).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
      );
    });

    it('passes scope, PKCE and redirect parameters to the client', async () => {
      mockClientInstance.authorizationUrl.mockReturnValue('https://example.com/authorize');

      await service.authorizationUrl(googleConfig, {
        state: 'state-1',
        nonce: 'nonce-1',
        codeChallenge: 'challenge-1',
        redirectUri: 'https://api.example.com/api/auth/sso/google/callback',
      });

      expect(mockClientInstance.authorizationUrl).toHaveBeenCalledWith({
        scope: 'openid email profile',
        redirect_uri: 'https://api.example.com/api/auth/sso/google/callback',
        state: 'state-1',
        nonce: 'nonce-1',
        code_challenge: 'challenge-1',
        code_challenge_method: 'S256',
      });
    });

    it('constructs the client with the configured client id, secret and redirect uri', async () => {
      mockClientInstance.authorizationUrl.mockReturnValue('https://example.com/authorize');

      await service.authorizationUrl(googleConfig, {
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
        redirectUri: 'https://api.example.com/api/auth/sso/google/callback',
      });

      expect(MockClientCtor).toHaveBeenCalledWith({
        client_id: 'google-client-id',
        client_secret: 'google-secret',
        redirect_uris: ['https://api.example.com/api/auth/sso/google/callback'],
        response_types: ['code'],
      });
    });

    it('caches issuer discovery: a second call for the same provider does not re-discover', async () => {
      mockClientInstance.authorizationUrl.mockReturnValue('https://example.com/authorize');

      await service.authorizationUrl(googleConfig, {
        state: 's1',
        nonce: 'n1',
        codeChallenge: 'c1',
        redirectUri: 'https://api.example.com/api/auth/sso/google/callback',
      });
      await service.authorizationUrl(googleConfig, {
        state: 's2',
        nonce: 'n2',
        codeChallenge: 'c2',
        redirectUri: 'https://api.example.com/api/auth/sso/google/callback',
      });

      expect(Issuer.discover).toHaveBeenCalledTimes(1);
    });

    it('discovers Google and Microsoft issuers separately (different cache keys)', async () => {
      mockClientInstance.authorizationUrl.mockReturnValue('https://example.com/authorize');

      await service.authorizationUrl(googleConfig, {
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
        redirectUri: 'https://api.example.com/api/auth/sso/google/callback',
      });
      await service.authorizationUrl(microsoftConfig, {
        state: 's',
        nonce: 'n',
        codeChallenge: 'c',
        redirectUri: 'https://api.example.com/api/auth/sso/microsoft/callback',
      });

      expect(Issuer.discover).toHaveBeenCalledTimes(2);
    });
  });

  describe('exchange', () => {
    it('exchanges the callback params via client.callback and returns the id token claims', async () => {
      const claims = { sub: 'idp-subject-1', email: 'user@example.com', email_verified: true };
      mockClientInstance.callback.mockResolvedValue({ claims: () => claims });

      const result = await service.exchange(googleConfig, {
        callbackParams: { code: 'auth-code', state: 'state-1' },
        redirectUri: 'https://api.example.com/api/auth/sso/google/callback',
        codeVerifier: 'verifier-1',
        state: 'state-1',
        nonce: 'nonce-1',
      });

      expect(mockClientInstance.callback).toHaveBeenCalledWith(
        'https://api.example.com/api/auth/sso/google/callback',
        { code: 'auth-code', state: 'state-1' },
        { state: 'state-1', nonce: 'nonce-1', code_verifier: 'verifier-1' },
      );
      expect(result).toEqual(claims);
    });

    it('propagates a rejection from the token exchange (e.g. bad code)', async () => {
      mockClientInstance.callback.mockRejectedValue(new Error('invalid_grant'));

      await expect(
        service.exchange(googleConfig, {
          callbackParams: { code: 'bad-code' },
          redirectUri: 'https://api.example.com/api/auth/sso/google/callback',
          codeVerifier: 'verifier-1',
          state: 'state-1',
          nonce: 'nonce-1',
        }),
      ).rejects.toThrow('invalid_grant');
    });
  });
});
