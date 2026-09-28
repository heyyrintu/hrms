import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuditAction, SsoProvider, UserRole } from '@prisma/client';
import { SsoService } from './sso.service';
import { OidcClientService } from './oidc-client.service';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { createMockPrismaService } from '../../../test/helpers';

jest.mock('openid-client', () => ({
  generators: {
    random: jest.fn(),
    codeVerifier: jest.fn(),
    codeChallenge: jest.fn(),
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generators } = jest.requireMock('openid-client');

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('SsoService', () => {
  let service: SsoService;
  let prisma: any;
  let authService: { resolveTenantId: jest.Mock; issueSession: jest.Mock };
  let oidcClient: { authorizationUrl: jest.Mock; exchange: jest.Mock };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };
  let audit: { log: jest.Mock };

  const tenantId = 'tenant-1';

  beforeEach(async () => {
    jest.clearAllMocks();
    (generators.random as jest.Mock).mockImplementation(
      () => `rand-${(generators.random as jest.Mock).mock.calls.length}`,
    );
    (generators.codeVerifier as jest.Mock).mockReturnValue('verifier-1');
    (generators.codeChallenge as jest.Mock).mockReturnValue('challenge-1');

    prisma = createMockPrismaService();
    authService = { resolveTenantId: jest.fn().mockResolvedValue(tenantId), issueSession: jest.fn() };
    oidcClient = { authorizationUrl: jest.fn(), exchange: jest.fn() };
    encryption = {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn((v: string) => v.replace('enc:', '')),
    };
    audit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SsoService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuthService, useValue: authService },
        { provide: OidcClientService, useValue: oidcClient },
        { provide: FieldEncryptionService, useValue: encryption },
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(undefined) } },
      ],
    }).compile();

    service = module.get(SsoService);
  });

  describe('providers', () => {
    it('returns enabled providers and requireSso for a known tenant', async () => {
      prisma.tenantSsoProvider.findMany.mockResolvedValue([{ provider: SsoProvider.GOOGLE }]);
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({ requireSso: true });

      const result = await service.providers('acme');

      expect(authService.resolveTenantId).toHaveBeenCalledWith('acme');
      expect(result).toEqual({ providers: [SsoProvider.GOOGLE], requireSso: true });
    });

    it('returns empty/false for an unknown or inactive org, without leaking anything', async () => {
      authService.resolveTenantId.mockRejectedValue(new UnauthorizedException('Tenant not found'));

      await expect(service.providers('nope')).resolves.toEqual({ providers: [], requireSso: false });
      expect(prisma.tenantSsoProvider.findMany).not.toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('creates a login-state row and returns the IdP authorisation URL', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        clientId: 'client-1',
        clientSecretEnc: 'enc:secret-1',
        entraTenantId: null,
        enabled: true,
      });
      oidcClient.authorizationUrl.mockResolvedValue('https://accounts.google.com/o/oauth2/auth?x=1');

      const url = await service.start(SsoProvider.GOOGLE, 'acme');

      expect(prisma.ssoLoginState.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
      expect(prisma.ssoLoginState.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          provider: SsoProvider.GOOGLE,
          stateHash: sha256('rand-1'),
          nonce: 'rand-2',
          codeVerifier: 'verifier-1',
          expiresAt: expect.any(Date),
        }),
      });
      expect(oidcClient.authorizationUrl).toHaveBeenCalledWith(
        {
          provider: SsoProvider.GOOGLE,
          clientId: 'client-1',
          clientSecret: 'secret-1',
          entraTenantId: null,
        },
        {
          state: 'rand-1',
          nonce: 'rand-2',
          codeChallenge: 'challenge-1',
          redirectUri: 'http://localhost:3001/api/auth/sso/google/callback',
        },
      );
      expect(url).toBe('https://accounts.google.com/o/oauth2/auth?x=1');
    });

    it('redirects to provider_disabled when the config is missing', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);

      const url = await service.start(SsoProvider.GOOGLE, 'acme');

      expect(url).toBe('http://localhost:3000/login?sso_error=provider_disabled&org=acme');
      expect(prisma.ssoLoginState.create).not.toHaveBeenCalled();
    });

    it('redirects to provider_disabled when the config is disabled', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({ enabled: false });

      const url = await service.start(SsoProvider.GOOGLE, 'acme');
      expect(url).toBe('http://localhost:3000/login?sso_error=provider_disabled&org=acme');
    });

    it('redirects to provider_disabled for an unknown org (tenant resolution fails)', async () => {
      authService.resolveTenantId.mockRejectedValue(new UnauthorizedException());

      const url = await service.start(SsoProvider.GOOGLE, 'nope');
      expect(url).toBe('http://localhost:3000/login?sso_error=provider_disabled&org=nope');
    });

    it('redirects to idp_error when building the authorisation URL fails', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        clientId: 'client-1',
        clientSecretEnc: 'enc:secret-1',
        entraTenantId: null,
        enabled: true,
      });
      oidcClient.authorizationUrl.mockRejectedValue(new Error('discovery failed'));

      const url = await service.start(SsoProvider.GOOGLE, 'acme');
      expect(url).toBe('http://localhost:3000/login?sso_error=idp_error&org=acme');
    });

    // M4: expired SsoExchangeCode rows are never cleaned up anywhere else —
    // start() already opportunistically cleans expired SsoLoginState rows,
    // and must do the same for SsoExchangeCode.
    it('also cleans up expired SsoExchangeCode rows', async () => {
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        clientId: 'client-1',
        clientSecretEnc: 'enc:secret-1',
        entraTenantId: null,
        enabled: true,
      });
      oidcClient.authorizationUrl.mockResolvedValue('https://accounts.google.com/o/oauth2/auth?x=1');

      await service.start(SsoProvider.GOOGLE, 'acme');

      expect(prisma.ssoExchangeCode.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });
  });

  describe('callback', () => {
    const query = { code: 'auth-code-1', state: 'state-1' };
    const stateRow: {
      id: string;
      tenantId: string;
      provider: SsoProvider;
      stateHash: string;
      nonce: string;
      codeVerifier: string;
      expiresAt: Date;
      consumedAt: Date | null;
    } = {
      id: 'state-row-1',
      tenantId,
      provider: SsoProvider.GOOGLE,
      stateHash: sha256('state-1'),
      nonce: 'nonce-1',
      codeVerifier: 'verifier-1',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    };
    const googleConfig = {
      clientId: 'client-1',
      clientSecretEnc: 'enc:secret-1',
      entraTenantId: null,
      enabled: true,
      allowedDomains: [] as string[],
      autoCreateUsers: false,
    };

    function mockValidState(overrides: Partial<typeof stateRow> = {}) {
      prisma.ssoLoginState.updateMany.mockResolvedValue({ count: 1 });
      prisma.ssoLoginState.findUnique.mockResolvedValue({ ...stateRow, ...overrides });
      prisma.tenant.findUnique.mockResolvedValue({ code: 'acme' });
    }

    it('redirects to invalid_state when the state param is missing or unknown/expired/reused', async () => {
      prisma.ssoLoginState.updateMany.mockResolvedValue({ count: 0 });

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=invalid_state');
    });

    // M3(a): the IdP redirected back with an error and no `code` (e.g. the
    // user hit cancel), but `state` is present and still matches a real,
    // readable login-state row. The tenant is knowable from that row, so the
    // error redirect must still carry `org` — otherwise the login page loses
    // track of which tenant's SSO buttons to show.
    it('M3(a): keeps org on an IdP error/cancel (no code) when the state row can still be read', async () => {
      prisma.ssoLoginState.findUnique.mockResolvedValue({ ...stateRow });
      prisma.tenant.findUnique.mockResolvedValue({ code: 'acme' });

      const url = await service.callback(SsoProvider.GOOGLE, { state: 'state-1', error: 'access_denied' });

      expect(url).toBe('http://localhost:3000/login?sso_error=idp_error&org=acme');
      expect(prisma.ssoLoginState.updateMany).not.toHaveBeenCalled();
    });

    it('M3(a): no org when state is entirely missing (nothing to look up)', async () => {
      const url = await service.callback(SsoProvider.GOOGLE, { error: 'access_denied' });
      expect(url).toBe('http://localhost:3000/login?sso_error=idp_error');
    });

    it('redirects to invalid_state when the row is for a different provider than the route', async () => {
      mockValidState({ provider: SsoProvider.MICROSOFT });

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=invalid_state&org=acme');
    });

    it('redirects to provider_disabled when the provider config no longer exists', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(null);

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=provider_disabled&org=acme');
    });

    it('redirects to idp_error when the token exchange fails', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockRejectedValue(new Error('invalid_grant'));

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=idp_error&org=acme');
      expect(oidcClient.exchange).toHaveBeenCalledWith(
        { provider: SsoProvider.GOOGLE, clientId: 'client-1', clientSecret: 'secret-1', entraTenantId: null },
        {
          callbackParams: query,
          redirectUri: 'http://localhost:3001/api/auth/sso/google/callback',
          codeVerifier: 'verifier-1',
          state: 'state-1',
          nonce: 'nonce-1',
        },
      );
    });

    it('redirects to email_unverified for Google when email_verified is not true', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'a@acme.com', email_verified: false });

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=email_unverified&org=acme');
    });

    it('redirects to wrong_directory for Microsoft when tid does not match entraTenantId', async () => {
      mockValidState({ provider: SsoProvider.MICROSOFT });
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        ...googleConfig,
        entraTenantId: 'tenant-guid-1',
      });
      oidcClient.exchange.mockResolvedValue({
        sub: 'sub-1',
        email: 'a@acme.com',
        tid: 'different-guid',
      });

      const url = await service.callback(SsoProvider.MICROSOFT, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=wrong_directory&org=acme');
    });

    it('redirects to no_account for Microsoft when neither email nor preferred_username has an @', async () => {
      mockValidState({ provider: SsoProvider.MICROSOFT });
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        ...googleConfig,
        entraTenantId: 'tenant-guid-1',
      });
      oidcClient.exchange.mockResolvedValue({
        sub: 'sub-1',
        tid: 'tenant-guid-1',
        preferred_username: 'not-an-email',
      });

      const url = await service.callback(SsoProvider.MICROSOFT, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=no_account&org=acme');
    });

    it('falls back to preferred_username for Microsoft when email is absent', async () => {
      mockValidState({ provider: SsoProvider.MICROSOFT });
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({
        ...googleConfig,
        entraTenantId: 'tenant-guid-1',
      });
      oidcClient.exchange.mockResolvedValue({
        sub: 'sub-1',
        tid: 'tenant-guid-1',
        preferred_username: 'A@Acme.com',
      });
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1', isActive: true, email: 'a@acme.com' });
      prisma.userIdentity.create.mockResolvedValue({});
      prisma.ssoExchangeCode.create.mockResolvedValue({});

      const url = await service.callback(SsoProvider.MICROSOFT, query);
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ email: { equals: 'a@acme.com', mode: 'insensitive' } }) }),
      );
      expect(url).toMatch(/^http:\/\/localhost:3000\/sso\/callback#code=/);
    });

    it('redirects to domain_not_allowed when allowedDomains is set and the email domain does not match', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({ ...googleConfig, allowedDomains: ['acme.com'] });
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'a@other.com', email_verified: true });

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=domain_not_allowed&org=acme');
    });

    it('matches an existing UserIdentity by (tenant, provider, sub) and updates lastUsedAt', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'a@acme.com', email_verified: true });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 'identity-1',
        subject: 'sub-1',
        user: { id: 'user-1', isActive: true },
      });
      prisma.userIdentity.update.mockResolvedValue({});
      prisma.ssoExchangeCode.create.mockResolvedValue({});

      const url = await service.callback(SsoProvider.GOOGLE, query);

      expect(prisma.userIdentity.findUnique).toHaveBeenCalledWith({
        where: { tenantId_provider_subject: { tenantId, provider: SsoProvider.GOOGLE, subject: 'sub-1' } },
        include: { user: true },
      });
      expect(prisma.userIdentity.update).toHaveBeenCalledWith({
        where: { id: 'identity-1' },
        data: { lastUsedAt: expect.any(Date) },
      });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(url).toMatch(/^http:\/\/localhost:3000\/sso\/callback#code=/);
    });

    it('matches by email (case-insensitive) and creates the identity when there is no conflict', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({
        sub: 'sub-1',
        email: 'Priya.S@Acme.com',
        email_verified: true,
      });
      prisma.userIdentity.findUnique
        .mockResolvedValueOnce(null) // step 1: no identity by sub
        .mockResolvedValueOnce(null); // step 2: no existing identity for this user+provider
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1', isActive: true, email: 'priya.s@acme.com' });
      prisma.userIdentity.create.mockResolvedValue({});
      prisma.ssoExchangeCode.create.mockResolvedValue({});

      await service.callback(SsoProvider.GOOGLE, query);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { tenantId, email: { equals: 'priya.s@acme.com', mode: 'insensitive' } },
      });
      expect(prisma.userIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          userId: 'user-1',
          provider: SsoProvider.GOOGLE,
          subject: 'sub-1',
          email: 'priya.s@acme.com',
        }),
      });
    });

    // I6: an HR_ADMIN who controls a directory (e.g. their own Microsoft
    // tenant) that asserts a SUPER_ADMIN's email must not be able to take
    // over that account through the email-match step. Treated as
    // `no_account` so the callback doesn't reveal the account exists, and no
    // identity is created (so no later `sub` binds either).
    it('I6: never binds or signs in a SUPER_ADMIN matched only by email — treated as no_account', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({ sub: 'attacker-sub', email: 'super@acme.com', email_verified: true });
      prisma.userIdentity.findUnique.mockResolvedValueOnce(null); // step 1: no identity by sub
      prisma.user.findFirst.mockResolvedValue({
        id: 'super-1',
        isActive: true,
        email: 'super@acme.com',
        role: UserRole.SUPER_ADMIN,
      });

      const url = await service.callback(SsoProvider.GOOGLE, query);

      expect(url).toBe('http://localhost:3000/login?sso_error=no_account&org=acme');
      expect(prisma.userIdentity.create).not.toHaveBeenCalled();
      expect(prisma.userIdentity.update).not.toHaveBeenCalled();
      expect(authService.issueSession).not.toHaveBeenCalled();
    });

    // A SUPER_ADMIN already bound by `sub` (step 4.1, identity match) is a
    // separate, unchanged path — the I6 restriction is only on the
    // email-match step.
    it('I6: a SUPER_ADMIN already bound by sub still matches via identity (step 4.1 unchanged)', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'super@acme.com', email_verified: true });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 'identity-1',
        subject: 'sub-1',
        user: { id: 'super-1', isActive: true, role: UserRole.SUPER_ADMIN },
      });
      prisma.userIdentity.update.mockResolvedValue({});
      prisma.ssoExchangeCode.create.mockResolvedValue({});

      const url = await service.callback(SsoProvider.GOOGLE, query);

      expect(url).toMatch(/^http:\/\/localhost:3000\/sso\/callback#code=/);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('I6: an HR_ADMIN matched by email still binds normally', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'hr@acme.com', email_verified: true });
      prisma.userIdentity.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.user.findFirst.mockResolvedValue({
        id: 'hr-1',
        isActive: true,
        email: 'hr@acme.com',
        role: UserRole.HR_ADMIN,
      });
      prisma.userIdentity.create.mockResolvedValue({});
      prisma.ssoExchangeCode.create.mockResolvedValue({});

      const url = await service.callback(SsoProvider.GOOGLE, query);

      expect(prisma.userIdentity.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'hr-1' }),
      });
      expect(url).toMatch(/^http:\/\/localhost:3000\/sso\/callback#code=/);
    });

    it('redirects to identity_conflict when the matched email user already has a different sub bound', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({ sub: 'new-sub', email: 'a@acme.com', email_verified: true });
      prisma.userIdentity.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'identity-1', subject: 'old-sub' });
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1', isActive: true, email: 'a@acme.com' });

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=identity_conflict&org=acme');
      expect(prisma.userIdentity.create).not.toHaveBeenCalled();
    });

    it('auto-creates a user linked to a matching employee with no login', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({ ...googleConfig, autoCreateUsers: true });
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'new@acme.com', email_verified: true });
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.employee.findFirst.mockResolvedValue({ id: 'employee-1' });
      prisma.user.create.mockResolvedValue({ id: 'user-1', isActive: true, email: 'new@acme.com' });
      prisma.userIdentity.create.mockResolvedValue({});
      prisma.ssoExchangeCode.create.mockResolvedValue({});

      const url = await service.callback(SsoProvider.GOOGLE, query);

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { tenantId, email: { equals: 'new@acme.com', mode: 'insensitive' }, user: null },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          email: 'new@acme.com',
          role: UserRole.EMPLOYEE,
          mustChangePassword: false,
          employeeId: 'employee-1',
        }),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.CREATE,
          entityType: 'User',
          newValues: { source: 'SSO', provider: SsoProvider.GOOGLE, linkedEmployee: true },
        }),
        prisma,
      );
      expect(url).toMatch(/^http:\/\/localhost:3000\/sso\/callback#code=/);
    });

    it('auto-creates a bare user when no employee matches', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({ ...googleConfig, autoCreateUsers: true });
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'new@acme.com', email_verified: true });
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.employee.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-1', isActive: true, email: 'new@acme.com' });
      prisma.userIdentity.create.mockResolvedValue({});
      prisma.ssoExchangeCode.create.mockResolvedValue({});

      await service.callback(SsoProvider.GOOGLE, query);

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ employeeId: undefined }) }),
      );
    });

    it('redirects to no_account when autoCreateUsers is off and no match exists', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue({ ...googleConfig, autoCreateUsers: false });
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'nobody@acme.com', email_verified: true });
      prisma.userIdentity.findUnique.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=no_account&org=acme');
      expect(prisma.employee.findFirst).not.toHaveBeenCalled();
    });

    it('redirects to account_inactive for a matched but inactive user', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'a@acme.com', email_verified: true });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 'identity-1',
        subject: 'sub-1',
        user: { id: 'user-1', isActive: false },
      });
      prisma.userIdentity.update.mockResolvedValue({});

      const url = await service.callback(SsoProvider.GOOGLE, query);
      expect(url).toBe('http://localhost:3000/login?sso_error=account_inactive&org=acme');
      expect(prisma.ssoExchangeCode.create).not.toHaveBeenCalled();
    });

    it('on success, creates a single-use exchange code and redirects with it in the fragment', async () => {
      mockValidState();
      prisma.tenantSsoProvider.findUnique.mockResolvedValue(googleConfig);
      oidcClient.exchange.mockResolvedValue({ sub: 'sub-1', email: 'a@acme.com', email_verified: true });
      prisma.userIdentity.findUnique.mockResolvedValue({
        id: 'identity-1',
        subject: 'sub-1',
        user: { id: 'user-1', isActive: true },
      });
      prisma.userIdentity.update.mockResolvedValue({});
      prisma.ssoExchangeCode.create.mockResolvedValue({});

      const url = await service.callback(SsoProvider.GOOGLE, query);

      expect(prisma.ssoExchangeCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId,
          userId: 'user-1',
          codeHash: expect.any(String),
          expiresAt: expect.any(Date),
        }),
      });
      expect(url).toMatch(/^http:\/\/localhost:3000\/sso\/callback#code=[A-Za-z0-9_-]+$/);
    });
  });

  describe('exchange', () => {
    it('consumes the code once and issues a session', async () => {
      prisma.ssoExchangeCode.updateMany.mockResolvedValue({ count: 1 });
      prisma.ssoExchangeCode.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', isActive: true });
      authService.issueSession.mockResolvedValue({ accessToken: 'jwt', user: {} });

      const result = await service.exchange('code-1');

      expect(authService.issueSession).toHaveBeenCalledWith({ id: 'user-1', isActive: true });
      expect(result).toEqual({ accessToken: 'jwt', user: {} });
    });

    it('401s on reuse (already consumed)', async () => {
      prisma.ssoExchangeCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.exchange('code-1')).rejects.toThrow(UnauthorizedException);
      expect(authService.issueSession).not.toHaveBeenCalled();
    });

    it('401s on an expired code', async () => {
      prisma.ssoExchangeCode.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.exchange('expired-code')).rejects.toThrow(
        'Sign-in link expired. Please try again.',
      );
    });

    it('401s when the matched user is inactive', async () => {
      prisma.ssoExchangeCode.updateMany.mockResolvedValue({ count: 1 });
      prisma.ssoExchangeCode.findUnique.mockResolvedValue({ userId: 'user-1' });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', isActive: false });

      await expect(service.exchange('code-1')).rejects.toThrow(UnauthorizedException);
      expect(authService.issueSession).not.toHaveBeenCalled();
    });
  });
});
