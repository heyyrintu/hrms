import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { generators } from 'openid-client';
import { AuditAction, SsoProvider, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { AuthService } from '../auth.service';
import { SessionResponse } from '../auth.types';
import { OidcClientService } from './oidc-client.service';

const STATE_TTL_MS = 10 * 60_000;
const EXCHANGE_CODE_TTL_MS = 60_000;

/** A refusal that maps to one of the fixed sso_error codes in spec §3.3. */
class SsoFlowError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * SSO sign-in flow: providers, start, callback, exchange.
 * Owned by WS-3 (plan Tasks 3.3–3.5).
 *
 * Reads `tenantSecuritySettings` through Prisma directly rather than
 * injecting SecuritySettingsService: that service lives in SecurityModule,
 * and AuthModule must never import SecurityModule back (spec §7).
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly oidcClient: OidcClientService,
    private readonly encryption: FieldEncryptionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private redirectUri(provider: SsoProvider): string {
    const base = this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3001/api';
    return `${base}/auth/sso/${provider.toLowerCase()}/callback`;
  }

  private errorUrl(code: string, org?: string | null): string {
    const frontend = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const params = new URLSearchParams({ sso_error: code });
    if (org) params.set('org', org);
    return `${frontend}/login?${params.toString()}`;
  }

  private async tenantCode(tenantId: string): Promise<string | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { code: true } });
    return tenant?.code ?? null;
  }

  /** Public: which providers a tenant code has, and whether it requires SSO. Never reveals more. */
  async providers(org?: string | null): Promise<{ providers: SsoProvider[]; requireSso: boolean }> {
    let tenantId: string;
    try {
      tenantId = await this.authService.resolveTenantId(org ?? undefined);
    } catch {
      return { providers: [], requireSso: false };
    }

    const [rows, settings] = await Promise.all([
      this.prisma.tenantSsoProvider.findMany({
        where: { tenantId, enabled: true },
        select: { provider: true },
        orderBy: { provider: 'asc' },
      }),
      this.prisma.tenantSecuritySettings.findUnique({ where: { tenantId } }),
    ]);

    return {
      providers: rows.map((row) => row.provider),
      requireSso: settings?.requireSso ?? false,
    };
  }

  /** Always resolves to a URL: the IdP authorisation URL, or a login?sso_error=... URL. */
  async start(provider: SsoProvider, org?: string | null): Promise<string> {
    let tenantId: string;
    try {
      tenantId = await this.authService.resolveTenantId(org ?? undefined);
    } catch {
      return this.errorUrl('provider_disabled', org);
    }

    // Opportunistic cleanup; nothing depends on this succeeding synchronously with the create below.
    await this.prisma.ssoLoginState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    // M4: SsoExchangeCode rows are otherwise never cleaned up anywhere.
    await this.prisma.ssoExchangeCode.deleteMany({ where: { expiresAt: { lt: new Date() } } });

    const providerConfig = await this.prisma.tenantSsoProvider.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    if (!providerConfig || !providerConfig.enabled) {
      return this.errorUrl('provider_disabled', org);
    }

    const state = generators.random();
    const nonce = generators.random();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    await this.prisma.ssoLoginState.create({
      data: {
        tenantId,
        provider,
        stateHash: sha256(state),
        nonce,
        codeVerifier,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });

    try {
      return await this.oidcClient.authorizationUrl(
        {
          provider,
          clientId: providerConfig.clientId,
          clientSecret: this.encryption.decrypt(providerConfig.clientSecretEnc),
          entraTenantId: providerConfig.entraTenantId,
        },
        { state, nonce, codeChallenge, redirectUri: this.redirectUri(provider) },
      );
    } catch (err) {
      this.logger.warn(`SSO start failed for ${provider}: ${(err as Error)?.message ?? err}`);
      return this.errorUrl('idp_error', org);
    }
  }

  /**
   * Matches the claims to a user (spec §3.3 step 4). Returns the matched or
   * newly created user, or null to refuse with `no_account`. Never throws
   * except SsoFlowError for a fixed error code (`identity_conflict`).
   */
  private async matchUser(
    tenantId: string,
    provider: SsoProvider,
    sub: string,
    email: string,
    autoCreateUsers: boolean,
  ): Promise<User | null> {
    const now = new Date();

    // 1. Already bound to this provider's permanent subject.
    const identity = await this.prisma.userIdentity.findUnique({
      where: { tenantId_provider_subject: { tenantId, provider, subject: sub } },
      include: { user: true },
    });
    if (identity) {
      await this.prisma.userIdentity.update({ where: { id: identity.id }, data: { lastUsedAt: now } });
      return identity.user;
    }

    // 2. Match by email within the tenant.
    const userByEmail = await this.prisma.user.findFirst({
      where: { tenantId, email: { equals: email, mode: 'insensitive' } },
    });
    if (userByEmail) {
      // I6: never bind or sign in a SUPER_ADMIN through the email-match
      // step — an HR_ADMIN who controls a directory that asserts a
      // SUPER_ADMIN's email must not be able to take over that account this
      // way. Treated as no_account so the callback reveals nothing. A
      // SUPER_ADMIN already bound by `sub` still matches at step 1, above,
      // which is unaffected.
      if (userByEmail.role === UserRole.SUPER_ADMIN) {
        return null;
      }
      const existingIdentity = await this.prisma.userIdentity.findUnique({
        where: { userId_provider: { userId: userByEmail.id, provider } },
      });
      if (existingIdentity) {
        if (existingIdentity.subject !== sub) {
          throw new SsoFlowError('identity_conflict');
        }
        await this.prisma.userIdentity.update({ where: { id: existingIdentity.id }, data: { lastUsedAt: now } });
      } else {
        await this.prisma.userIdentity.create({
          data: { tenantId, userId: userByEmail.id, provider, subject: sub, email, lastUsedAt: now },
        });
      }
      return userByEmail;
    }

    // 3. Auto-create, linking an existing employee with no login if one matches.
    if (autoCreateUsers) {
      return this.autoCreateUser(tenantId, provider, sub, email);
    }

    // 4. Refuse.
    return null;
  }

  private async autoCreateUser(
    tenantId: string,
    provider: SsoProvider,
    sub: string,
    email: string,
  ): Promise<User> {
    // No one knows this password; SSO is the only way in for an auto-created account.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { tenantId, email: { equals: email, mode: 'insensitive' }, user: null },
      });

      const user = await tx.user.create({
        data: {
          tenantId,
          email,
          passwordHash,
          role: UserRole.EMPLOYEE,
          mustChangePassword: false,
          employeeId: employee?.id,
        },
      });

      await tx.userIdentity.create({
        data: { tenantId, userId: user.id, provider, subject: sub, email, lastUsedAt: now },
      });

      await this.audit.log(
        {
          tenantId,
          userId: user.id,
          action: AuditAction.CREATE,
          entityType: 'User',
          entityId: user.id,
          newValues: { source: 'SSO', provider, linkedEmployee: !!employee },
        },
        tx,
      );

      return user;
    });
  }

  /** Always resolves to a URL: `${FRONTEND_URL}/sso/callback#code=...`, or a login?sso_error=... URL. */
  async callback(provider: SsoProvider, query: Record<string, string>): Promise<string> {
    try {
      return await this.doCallback(provider, query);
    } catch (err) {
      if (err instanceof SsoFlowError) {
        return this.errorUrl(err.code);
      }
      this.logger.warn(`SSO callback failed for ${provider}: ${(err as Error)?.message ?? err}`);
      return this.errorUrl('idp_error');
    }
  }

  private async doCallback(provider: SsoProvider, query: Record<string, string>): Promise<string> {
    const state = query.state;

    if (!state || !query.code) {
      // M3(a): the IdP sent an error (or the user cancelled) with no code,
      // but a `state` may still be present and readable — look up its
      // tenant so the redirect keeps `org` and the login page still shows
      // the right tenant's buttons. This is a read-only lookup: the state
      // row is not consumed here (there is no code to exchange with it
      // anyway; the real consuming lookup below only runs once code is
      // present).
      let org: string | null = null;
      if (state) {
        const row = await this.prisma.ssoLoginState.findUnique({ where: { stateHash: sha256(state) } });
        if (row) {
          org = await this.tenantCode(row.tenantId);
        }
      }
      return this.errorUrl('idp_error', org);
    }

    const stateHash = sha256(state);
    const now = new Date();
    const consumed = await this.prisma.ssoLoginState.updateMany({
      where: { stateHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new SsoFlowError('invalid_state');
    }

    const stateRow = await this.prisma.ssoLoginState.findUnique({ where: { stateHash } });
    if (!stateRow) {
      throw new SsoFlowError('invalid_state');
    }

    const { tenantId } = stateRow;
    const org = await this.tenantCode(tenantId);

    if (stateRow.provider !== provider) {
      return this.errorUrl('invalid_state', org);
    }

    const providerConfig = await this.prisma.tenantSsoProvider.findUnique({
      where: { tenantId_provider: { tenantId, provider } },
    });
    if (!providerConfig || !providerConfig.enabled) {
      return this.errorUrl('provider_disabled', org);
    }

    let claims;
    try {
      claims = await this.oidcClient.exchange(
        {
          provider,
          clientId: providerConfig.clientId,
          clientSecret: this.encryption.decrypt(providerConfig.clientSecretEnc),
          entraTenantId: providerConfig.entraTenantId,
        },
        {
          callbackParams: query,
          redirectUri: this.redirectUri(provider),
          codeVerifier: stateRow.codeVerifier,
          state,
          nonce: stateRow.nonce,
        },
      );
    } catch (err) {
      this.logger.warn(`SSO token exchange failed for ${provider}: ${(err as Error)?.message ?? err}`);
      return this.errorUrl('idp_error', org);
    }

    let email: string;
    if (provider === SsoProvider.GOOGLE) {
      if (!claims.email || claims.email_verified !== true) {
        return this.errorUrl('email_unverified', org);
      }
      email = claims.email;
    } else {
      if (claims.tid !== providerConfig.entraTenantId) {
        return this.errorUrl('wrong_directory', org);
      }
      const candidate = claims.email ?? claims.preferred_username;
      if (!candidate || !candidate.includes('@')) {
        return this.errorUrl('no_account', org);
      }
      email = candidate;
    }
    email = email.trim().toLowerCase();

    if (providerConfig.allowedDomains.length > 0) {
      const domain = email.split('@')[1] ?? '';
      if (!providerConfig.allowedDomains.includes(domain)) {
        return this.errorUrl('domain_not_allowed', org);
      }
    }

    let user: User | null;
    try {
      user = await this.matchUser(tenantId, provider, claims.sub, email, providerConfig.autoCreateUsers);
    } catch (err) {
      if (err instanceof SsoFlowError) {
        return this.errorUrl(err.code, org);
      }
      throw err;
    }

    if (!user) {
      return this.errorUrl('no_account', org);
    }
    if (!user.isActive) {
      return this.errorUrl('account_inactive', org);
    }

    const code = randomBytes(32).toString('base64url');
    await this.prisma.ssoExchangeCode.create({
      data: {
        tenantId,
        userId: user.id,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + EXCHANGE_CODE_TTL_MS),
      },
    });

    const frontend = this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    return `${frontend}/sso/callback#code=${code}`;
  }

  /** Trades a single-use exchange code (from the fragment) for a real session. */
  async exchange(code: string): Promise<SessionResponse> {
    const invalid = () => new UnauthorizedException('Sign-in link expired. Please try again.');

    const codeHash = sha256(code);
    const now = new Date();
    const consumed = await this.prisma.ssoExchangeCode.updateMany({
      where: { codeHash, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw invalid();
    }

    const row = await this.prisma.ssoExchangeCode.findUnique({ where: { codeHash } });
    if (!row) {
      throw invalid();
    }

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.isActive) {
      throw invalid();
    }

    return this.authService.issueSession(user);
  }
}
