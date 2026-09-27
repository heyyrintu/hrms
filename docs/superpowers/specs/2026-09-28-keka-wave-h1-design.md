# Keka Wave H1 — Security: SSO, two-factor authentication, custom roles

**Date:** 2026-09-28
**Roadmap:** `docs/plans/2026-09-23-keka-parity-roadmap.md` (Wave H, part H1)
**Baseline:** `main` at `77bc80a` (Waves C and D merged). Branch `feat/keka-wave-h1`.
**Format reference:** `docs/superpowers/specs/2026-09-27-keka-wave-c-d-design.md`
**Built in parallel with:** Wave E (engagement), another branch. H1 must not
change how `@Roles()` + `@UseGuards(JwtAuthGuard, RolesGuard)` behave, so
Wave E's new controllers work unchanged after both merge.

## Goal

1. **Single sign-on** with Google and Microsoft (OpenID Connect), configured per
   tenant. Users are matched by email within the tenant. No account is created
   unless the tenant turns auto-create on.
2. **Two-factor authentication** with TOTP plus single-use recovery codes. A
   tenant admin can require it per fixed role.
3. **Custom roles**: named bundles of permissions granted on top of the four
   fixed roles. Fixed roles keep working exactly as today.

With no tenant configuration, existing behaviour is unchanged: no SSO buttons,
no 2FA prompt, no custom roles, and every JWT already issued stays valid.

## Product decisions (agreed 2026-09-28)

| # | Decision |
|---|---|
| P1 | Custom roles are **additive**. Every user keeps exactly one fixed `role`, which still drives all data scoping. A custom role only adds permissions on endpoints that opt in. It can never remove access. |
| P2 | SSO resolves the tenant the same way password login does: `DEFAULT_TENANT_ID`, overridable with `/login?org=<tenant code>`. |
| P3 | SSO logins skip TOTP. The identity provider owns MFA. 2FA enforcement applies to password logins only. |
| P4 | A tenant can switch on **SSO-only**. SUPER_ADMIN accounts can always still sign in with password (+ 2FA if enabled) as a break-glass. |
| P5 | The controllers listed in §1.4 move to permissions in H1 (26 files; the list agreed in chat, where it was miscounted as 24). Controllers whose services branch on `user.role` are follow-ups (§1.5). |
| P6 | When a role starts requiring 2FA, unenrolled users are forced to enrol at their **next password sign-in**. Sessions already open keep working until they expire. |
| P7 | SSO auto-create links to an existing employee with that work email and no login; otherwise it creates a bare EMPLOYEE user. Only emails in the provider's allowed domains qualify. |
| P8 | Security administration (SSO config, 2FA policy, custom roles, user role assignment, 2FA reset) stays with the SUPER_ADMIN and HR_ADMIN fixed roles. It is **not** a grantable permission. |
| P9 | The permission check is added to the existing `RolesGuard` ("role OR permission"), not a new guard. |
| P10 | SSO is backend-driven: the API runs the OIDC code flow, the browser receives only a single-use exchange code. |

## Conventions (all workstreams)

- Every new model has `tenantId` and every query is scoped by it. Every
  `@@unique` that is not an id includes `tenantId` or a tenant-scoped parent id.
- Errors: 400 validation / wrong state, 401 bad credentials or code, 403
  authorization, 404 missing (also for other tenants' ids), 409 duplicates.
- Protected controllers: `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(...)`.
  There is no global auth guard; public routes simply omit `JwtAuthGuard`.
- Rate limiting: `ThrottlerModule` is registered globally for storage only.
  Apply `@UseGuards(ThrottlerGuard)` + `@Throttle(...)` per route (the
  `AuthController.login` pattern). Behind a proxy, `TRUST_PROXY` decides the
  client IP (Wave C/D).
- `AuthenticatedUser.employeeId` is optional: guard it before using it in a
  Prisma `where`.
- Audit every configuration change and every admin action on another user with
  `AuditService.log(input, tx?)`. Audit rows never contain secrets or codes.
- **Secrets never leave the API.** Services map rows to responses with an
  explicit field list, never `...row`. The encrypted columns
  (`*SecretEnc`) and hashes (`codeHash`) must not appear in any response body.
  Tests assert this.

---

## 1. Permissions and custom roles

### 1.1 Catalogue

`backend/src/common/permissions/permissions.ts` exports the grantable
permissions as a const array and a `Permission` string-union type:

| Key | Group | Grants |
|---|---|---|
| `org.manage` | Organisation | departments, designations, branches, holidays, shifts admin, document expiry |
| `attendance.config.manage` | Attendance | attendance policy, biometric devices |
| `leave.config.manage` | Leave | accrual rules and runs, carry-forward |
| `payroll.statutory.manage` | Payroll | statutory config, PT/IT slabs |
| `payroll.proofs.review` | Payroll | review investment proofs |
| `payroll.reports.view` | Payroll | statutory returns, bank transfer file, variance report |
| `payroll.accounting.manage` | Payroll | GL mapping, accounting config, journal export |
| `payroll.adjustments.manage` | Payroll | payroll settings, one-time payments, arrears, holds, settlements in run |
| `exit.manage` | Exit | separations, full and final settlement |
| `recruitment.config.manage` | Recruitment | recruitment settings, pipeline stages, candidates |
| `employees.import` | Employees | bulk employee import |
| `audit.view` | Security | audit log |
| `integrations.manage` | Integrations | webhooks, approval workflow definitions |

Each entry has `{ key, group, label, description }`. `GET /security/permissions`
returns the array. A custom role may only hold keys from this list (400
otherwise).

### 1.2 Data model

```prisma
model CustomRole {
  id          String   @id @default(uuid())
  tenantId    String
  name        String   @db.VarChar(80)
  description String?  @db.VarChar(500)
  permissions String[]
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant Tenant           @relation(fields: [tenantId], references: [id])
  users  UserCustomRole[]

  @@unique([tenantId, name])
  @@index([tenantId])
  @@map("custom_roles")
}

model UserCustomRole {
  id           String   @id @default(uuid())
  tenantId     String
  userId       String
  customRoleId String
  assignedById String?
  createdAt    DateTime @default(now())

  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  customRole CustomRole @relation(fields: [customRoleId], references: [id], onDelete: Cascade)

  @@unique([userId, customRoleId])
  @@index([tenantId])
  @@index([customRoleId])
  @@map("user_custom_roles")
}
```

### 1.3 Enforcement

- `@RequirePermissions(...keys: Permission[])` in
  `backend/src/common/permissions/require-permissions.decorator.ts` sets
  `PERMISSIONS_KEY` metadata. Any one of the listed keys is enough.
- `RolesGuard` reads both `ROLES_KEY` and `PERMISSIONS_KEY` with
  `getAllAndOverride` (handler over class, as today):
  - Neither present → allow (unchanged).
  - SUPER_ADMIN → allow (unchanged).
  - `requiredRoles` includes `user.role` → allow (unchanged).
  - `requiredPermissions` intersects `user.permissions` → allow (new).
  - Otherwise → deny.
  A route with `@Roles` and no `@RequirePermissions` therefore behaves exactly
  as before. That is Wave E's case and has its own test.
- `AuthenticatedUser` gains `permissions: string[]` (the union of the user's
  custom roles' permissions, deduplicated; `[]` when none).
  `AuthService.validateUser` loads them in the same query that already runs on
  every request (`include: { customRoles: { include: { customRole: true } } }`),
  so grants and revocations apply on the next request with no re-login.
  Permission keys no longer in the catalogue are dropped when loading.
- Permissions are **not** stored in the JWT.

### 1.4 Controllers moved in H1

Rule: add `@RequirePermissions(key)` at the **same level** as each existing
`@Roles(...)` (class or method) in these files, and change nothing else. An
endpoint without `@Roles` (e.g. an employee's own `mine` route) gets nothing.

| File (`backend/src/modules/…`) | Key |
|---|---|
| `departments/departments.controller.ts` | `org.manage` |
| `designations/designations.controller.ts` | `org.manage` |
| `branches/branches.controller.ts` | `org.manage` |
| `holidays/holidays.controller.ts` | `org.manage` |
| `shifts/shifts.controller.ts` | `org.manage` |
| `documents/document-expiry.controller.ts` | `org.manage` |
| `attendance/policy/attendance-policy.controller.ts` | `attendance.config.manage` |
| `biometric/biometric-admin.controller.ts` | `attendance.config.manage` |
| `leave/leave-accrual.controller.ts` | `leave.config.manage` |
| `leave/leave-carry-forward.controller.ts` | `leave.config.manage` |
| `payroll/statutory/statutory.controller.ts` | `payroll.statutory.manage` |
| `payroll/slabs/slabs.controller.ts` | `payroll.statutory.manage` |
| `payroll/proofs/proofs.controller.ts` | `payroll.proofs.review` |
| `payroll/returns/returns.controller.ts` | `payroll.reports.view` |
| `payroll/accounting/payroll-reports.controller.ts` | `payroll.reports.view` |
| `payroll/accounting/payroll-accounting.controller.ts` | `payroll.accounting.manage` |
| `payroll/adjustments/payroll-adjustments.controller.ts` | `payroll.adjustments.manage` |
| `exit/exit.controller.ts` | `exit.manage` |
| `exit/settlement/settlement.controller.ts` | `exit.manage` |
| `recruitment/recruitment-settings.controller.ts` | `recruitment.config.manage` |
| `recruitment/pipeline-stages.controller.ts` | `recruitment.config.manage` |
| `recruitment/candidates.controller.ts` | `recruitment.config.manage` |
| `employees/import/employee-import.controller.ts` | `employees.import` |
| `audit/audit.controller.ts` | `audit.view` |
| `webhooks/webhooks.controller.ts` | `integrations.manage` |
| `workflow/workflows.controller.ts` | `integrations.manage` |

(26 files, the exact list agreed on 2026-09-28.)

Before decorating, the implementer confirms that the controller and its service
do not branch on `user.role`. If one does, it moves to §1.5 and the PR body
says so.

### 1.5 Follow-ups (not in H1)

Services branch on `user.role` for scoping, so a custom-role holder would get a
wrong view until the service changes: payroll (main controller), leave,
attendance, regularization, comp-off, expenses, performance, onboarding,
letters, loans, helpdesk, pip, feedback, reports, employees, admin, documents,
companies, recruitment openings / applications / interviews / offers /
requisitions / reports, workflow approvals and delegations. `announcements` is
also deferred because Wave E is likely to edit it.

### 1.6 Admin API (`SecurityModule`, all `@Roles(SUPER_ADMIN, HR_ADMIN)`)

| Method | Route | Body / query | Notes |
|---|---|---|---|
| GET | `/security/permissions` | — | catalogue |
| GET | `/security/roles` | — | each role with `userCount` |
| POST | `/security/roles` | `{ name, description?, permissions[] }` | 409 on duplicate name; audited |
| PATCH | `/security/roles/:id` | same fields, all optional | audited |
| DELETE | `/security/roles/:id` | — | cascades assignments; audited |
| GET | `/security/users` | `?search=&page=&limit=` | paginated `{ data, meta }`; row: `id, email, role, isActive, employeeName, twoFactorEnabled, customRoles[{id,name}], ssoProviders[]` |
| PUT | `/security/users/:id/roles` | `{ customRoleIds[] }` | replaces the set in one transaction; every id must be this tenant's (400); audited with before/after names |

Validation: `name` 1–80 chars, trimmed; `permissions` non-empty, unique,
catalogue keys only.

---

## 2. Two-factor authentication (TOTP)

### 2.1 Data model

```prisma
// on User (added fields)
  totpSecretEnc        String?   // AES-GCM via FieldEncryptionService
  totpPendingSecretEnc String?   // set by /2fa/setup, promoted by /2fa/enable
  totpEnabledAt        DateTime?
  totpLastStep         Int?      // last accepted 30 s step; blocks replay
  // relations
  customRoles    UserCustomRole[]
  recoveryCodes  UserRecoveryCode[]
  mfaChallenges  MfaChallenge[]
  identities     UserIdentity[]

model TenantSecuritySettings {
  id                     String     @id @default(uuid())
  tenantId               String     @unique
  requireSso             Boolean    @default(false)
  twoFactorRequiredRoles UserRole[] @default([])
  updatedById            String?
  createdAt              DateTime   @default(now())
  updatedAt              DateTime   @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])
  @@map("tenant_security_settings")
}

model UserRecoveryCode {
  id        String    @id @default(uuid())
  tenantId  String
  userId    String
  codeHash  String    @db.VarChar(64)   // sha256 hex
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([tenantId])
  @@map("user_recovery_codes")
}

model MfaChallenge {
  id         String    @id @default(uuid())
  tenantId   String
  userId     String
  attempts   Int       @default(0)
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([tenantId])
  @@map("mfa_challenges")
}
```

A tenant with no `TenantSecuritySettings` row behaves as
`{ requireSso: false, twoFactorRequiredRoles: [] }`.

### 2.2 Step tokens

Two short-lived JWTs signed with `JWT_SECRET`, each with a `typ` claim:

| `typ` | Claims | Lifetime | Used by |
|---|---|---|---|
| `mfa` | `sub, tenantId, cid` (MfaChallenge id) | 5 min | `POST /auth/2fa/verify` |
| `enrol` | `sub, tenantId, tokenVersion` | 15 min | `POST /auth/2fa/setup`, `POST /auth/2fa/enable` |

`JwtStrategy.validate` rejects any payload that has a `typ` (401). Tokens issued
today carry no `typ`, so every existing session keeps working. A token without
`tokenVersion` is still accepted (unchanged rule).

### 2.3 Password login (`POST /auth/login`)

Evaluated in this order after the password is verified:

1. **SSO-only:** tenant `requireSso` and `user.role !== SUPER_ADMIN` → 403
   `"Your organisation signs in with single sign-on."` (checked only after a
   correct password, so it reveals nothing to someone without the password).
2. **2FA enabled** (`totpEnabledAt` set) → create an `MfaChallenge`
   (expires in 5 min) and return `{ mfaRequired: true, mfaToken }`. No
   `accessToken`, `lastLoginAt` not updated.
3. **2FA required but not enrolled** (`user.role` in
   `twoFactorRequiredRoles`, no `totpEnabledAt`) → return
   `{ enrolmentRequired: true, enrolToken }`.
4. Otherwise the existing response, unchanged, via `AuthService.issueSession(user)`.

`AuthService.issueSession(user)` (extracted from `login` in the scaffold) signs
the normal JWT, updates `lastLoginAt`, and returns
`{ accessToken, user: { id, email, role, tenantId, employeeId, mustChangePassword, permissions } }`.
Password login, 2FA verify, 2FA enable and SSO exchange all end in it.

### 2.4 Endpoints (`auth/two-factor/`)

| Method | Route | Auth | Throttle | Behaviour |
|---|---|---|---|---|
| POST | `/auth/2fa/verify` | mfa token in body | 5/min/IP | `{ mfaToken, code }`. `code` is a 6-digit TOTP or a recovery code (`xxxxx-xxxxx`). Challenge must exist, match `sub`, be unconsumed, unexpired, `attempts < 5`. Wrong code → `attempts++`, 401; the 5th wrong code consumes the challenge. Right code → consume challenge (and the recovery code, if one was used), `issueSession`. |
| POST | `/auth/2fa/setup` | session **or** enrol token | 10/min/IP | 400 if already enabled. New 20-byte base32 secret → `totpPendingSecretEnc`. Returns `{ otpauthUrl, qrCodeDataUrl }` (issuer = tenant name, label = email). This is the only response that carries the secret, and only inside the URI. |
| POST | `/auth/2fa/enable` | session **or** enrol token | 5/min/IP | `{ code }` checked against the pending secret. Promotes it to `totpSecretEnc`, sets `totpEnabledAt`, clears pending, replaces recovery codes with 10 new ones, increments `tokenVersion`. Returns `{ recoveryCodes, session: issueSession(user) }`. |
| POST | `/auth/2fa/disable` | session | 5/min/IP | `{ password, code }`. 403 if the user's role is in `twoFactorRequiredRoles`. Clears TOTP fields and recovery codes, increments `tokenVersion`, returns a fresh session. |
| POST | `/auth/2fa/recovery-codes` | session | 5/min/IP | `{ code }` (TOTP). Replaces all recovery codes; returns the new 10. |
| GET | `/auth/2fa/status` | session | — | `{ enabled, enabledAt, required, recoveryCodesRemaining }` |

A guard (`SessionOrEnrolGuard`) accepts either a normal session (via the JWT
strategy) or a valid `enrol` token whose `tokenVersion` matches and whose user
has not enabled 2FA.

TOTP rules (otplib): SHA-1, 6 digits, 30 s step, ±1 step window. A code whose
step is `<= totpLastStep` is rejected. The accepted step is written in the same
update that consumes the challenge.

Recovery codes: 10 codes, 10 base32 characters each shown as `xxxxx-xxxxx`
(50 bits). Stored as sha256 hex of the normalised code (lower-case, no dash),
compared with `timingSafeEqual`. Each code works once.

### 2.5 Admin policy and reset (`SecurityModule`, `@Roles(SUPER_ADMIN, HR_ADMIN)`)

| Method | Route | Body | Notes |
|---|---|---|---|
| GET | `/security/settings` | — | `{ requireSso, twoFactorRequiredRoles, providers: SsoProviderView[] }` (§3.4) |
| PUT | `/security/settings` | `{ requireSso?, twoFactorRequiredRoles? }` | `requireSso: true` needs at least one enabled provider (400). Audited. |
| POST | `/security/users/:id/2fa/reset` | — | Clears TOTP fields and recovery codes, increments `tokenVersion`. An HR_ADMIN cannot reset a SUPER_ADMIN (403). Audited. |

Turning on a role requirement does not sign anyone out (P6).

### 2.6 Wave A password reset

- `forgot-password`: when the tenant is SSO-only and the user is not a
  SUPER_ADMIN, send no email. The response body and status stay identical.
- `reset-password`: for the same users, refuse with the existing generic
  400 "invalid or expired" message and burn the token.
- Reset does not touch 2FA. The next login still asks for a code.
- Everything else in `password-reset.service.ts` is unchanged, and its existing
  spec must pass without edits beyond mock additions.

---

## 3. Single sign-on (OpenID Connect)

### 3.1 Data model

```prisma
enum SsoProvider {
  GOOGLE
  MICROSOFT
}

model TenantSsoProvider {
  id              String      @id @default(uuid())
  tenantId        String
  provider        SsoProvider
  clientId        String      @db.VarChar(255)
  clientSecretEnc String      // AES-GCM via FieldEncryptionService
  entraTenantId   String?     @db.VarChar(64)   // Microsoft directory (tenant) id, required for MICROSOFT
  enabled         Boolean     @default(false)
  allowedDomains  String[]    // lower-case; empty = any domain (not allowed with autoCreateUsers)
  autoCreateUsers Boolean     @default(false)
  updatedById     String?
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id])
  @@unique([tenantId, provider])
  @@map("tenant_sso_providers")
}

model UserIdentity {
  id         String      @id @default(uuid())
  tenantId   String
  userId     String
  provider   SsoProvider
  subject    String      @db.VarChar(255)   // IdP `sub`
  email      String      @db.VarChar(255)   // email at bind time, for display
  lastUsedAt DateTime?
  createdAt  DateTime    @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([tenantId, provider, subject])
  @@unique([userId, provider])
  @@index([tenantId])
  @@map("user_identities")
}

model SsoLoginState {
  id           String      @id @default(uuid())
  tenantId     String
  provider     SsoProvider
  stateHash    String      @unique @db.VarChar(64)   // sha256 of the state param
  nonce        String      @db.VarChar(128)
  codeVerifier String      @db.VarChar(128)
  expiresAt    DateTime
  consumedAt   DateTime?
  createdAt    DateTime    @default(now())

  @@index([tenantId])
  @@index([expiresAt])
  @@map("sso_login_states")
}

model SsoExchangeCode {
  id         String    @id @default(uuid())
  tenantId   String
  userId     String
  codeHash   String    @unique @db.VarChar(64)   // sha256
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([tenantId])
  @@index([expiresAt])
  @@map("sso_exchange_codes")
}
```

Rows in `SsoLoginState` / `SsoExchangeCode` are consumed with a conditional
`updateMany({ where: { id, consumedAt: null, expiresAt: { gt: now } } })` and
checking `count === 1`, so two concurrent callbacks cannot both succeed. Rows
past `expiresAt` are deleted opportunistically at the start of each `start`
call.

### 3.2 Provider specifics

| | Google | Microsoft |
|---|---|---|
| Issuer | `https://accounts.google.com` | `https://login.microsoftonline.com/{entraTenantId}/v2.0` |
| Discovery | `…/.well-known/openid-configuration` of the issuer (cached per process) | same |
| Scopes | `openid email profile` | `openid email profile` |
| Email claim | `email`, and `email_verified === true` is required | `email`, falling back to `preferred_username` |
| Extra check | if `allowedDomains` set, email domain must match | `tid` claim must equal `entraTenantId` |

Library: `openid-client@5` (CommonJS; v6 is ESM-only and breaks Jest). PKCE
S256, `state`, `nonce`, `response_type=code`. The id_token signature, `iss`,
`aud`, `exp` and `nonce` are verified by the library.
Redirect URI: `${API_PUBLIC_URL}/auth/sso/{google|microsoft}/callback`
(`API_PUBLIC_URL` is a new optional env, default `http://localhost:3001/api`).

### 3.3 Flow

| Method | Route | Throttle | Behaviour |
|---|---|---|---|
| GET | `/auth/sso/providers?org=` | 30/min/IP | Public. Resolves the tenant (P2; unknown or inactive → `{ providers: [], requireSso: false }`). Returns `{ providers: ['GOOGLE', …] (enabled only), requireSso }`. |
| GET | `/auth/sso/:provider/start?org=` | 20/min/IP | Public. Provider must be enabled for the tenant, else redirect to the error URL. Creates `SsoLoginState` (10 min) and 302s to the IdP authorisation URL. |
| GET | `/auth/sso/:provider/callback` | 10/min/IP | Public. See below. Always ends in a 302 to the frontend. |
| POST | `/auth/sso/exchange` | 10/min/IP | Public. `{ code }` → consumes the `SsoExchangeCode` (60 s, single use) and returns `issueSession(user)`. 401 otherwise. |

Callback steps:

1. Look up `SsoLoginState` by `sha256(state)`. It must match the route's
   provider and be unconsumed and unexpired. Consume it.
2. Exchange the code with the stored `codeVerifier`. Verify the id_token with
   the stored `nonce`. Apply the provider checks in §3.2.
3. Normalise the email (trim, lower-case). If `allowedDomains` is non-empty,
   its domain must be listed.
4. **Match** in this order:
   1. `UserIdentity(tenantId, provider, sub)` → that user.
   2. Else a `User` in the tenant with that email (case-insensitive). If the
      user already has a `UserIdentity` for this provider with a different
      `sub` → refuse (`identity_conflict`). Otherwise create the identity.
   3. Else, if `autoCreateUsers`: an `Employee` in the tenant with that email
      and no user → create a `User` (`EMPLOYEE`, linked to the employee).
      Otherwise create a bare `EMPLOYEE` user. Either way the password hash is
      bcrypt of 32 random bytes, which no one knows, and `mustChangePassword`
      is false. Create the identity. Audited as `SSO_USER_CREATED`.
   4. Else refuse (`no_account`).
5. The user must be active (`account_inactive`). SSO-only does not block SSO.
   2FA is skipped (P3).
6. Update `identity.lastUsedAt`, create an `SsoExchangeCode`, and redirect to
   `${FRONTEND_URL}/sso/callback#code=<code>`. The code is in the fragment, so it
   is not sent to any server or written to access logs.

Every failure redirects to `${FRONTEND_URL}/login?sso_error=<code>` with one of
`invalid_state`, `provider_disabled`, `idp_error`, `email_unverified`,
`domain_not_allowed`, `wrong_directory`, `identity_conflict`, `no_account`,
`account_inactive`. The reason and IdP error detail go to the server log only.
When the tenant came from `?org=`, the error redirect keeps `org` so the page
shows the same tenant's buttons.

### 3.4 Admin config (`SecurityModule`, `@Roles(SUPER_ADMIN, HR_ADMIN)`)

| Method | Route | Body | Notes |
|---|---|---|---|
| PUT | `/security/sso/:provider` | `{ clientId, clientSecret?, entraTenantId?, enabled, allowedDomains[], autoCreateUsers }` | Upsert. `clientSecret` is required on create and optional on update (omitted = keep). `entraTenantId` required for MICROSOFT (GUID). `autoCreateUsers: true` requires non-empty `allowedDomains`. Domains validated as hostnames and lower-cased. Audited without the secret. |
| DELETE | `/security/sso/:provider` | — | 400 if it is the last enabled provider while `requireSso` is on. Deletes the config; `UserIdentity` rows stay so a re-created config matches the same people. Audited. |

`SsoProviderView` (used by `GET /security/settings`):
`{ provider, clientId, hasClientSecret: true, entraTenantId, enabled, allowedDomains, autoCreateUsers, redirectUri, updatedAt }`.
The secret itself is never returned.

---

## 4. Frontend

### 4.1 Auth flow (`frontend/src`)

- `app/(auth)/login/page.tsx`: reads `?org=` and `?sso_error=`. Renders
  `<SsoButtons org>` above the password form (hidden when the tenant has no
  providers; when `requireSso`, the password form collapses behind a
  "Sign in with password (administrators)" link). After password submit:
  - `mfaRequired` → code step (6-digit input, "Use a recovery code" toggle).
  - `enrolmentRequired` → enrolment step: QR + manual key from the otpauth URI,
    confirm code, then the recovery codes screen (copy, download as .txt, "I
    have saved these" to continue).
  - otherwise the existing path.
- `app/(auth)/sso/callback/page.tsx`: reads `#code`, clears the fragment with
  `history.replaceState`, calls `/auth/sso/exchange`, stores the session the
  same way `login` does, goes to `/dashboard`. On failure → `/login?sso_error=idp_error`.
- `contexts/AuthContext.tsx`: `login` returns a discriminated result
  (`'done' | 'mfa' | 'enrol'`); new `completeSession(response)`,
  `hasPermission(key)`; `user.permissions` stored with the user.
- `app/(protected)/my-security/page.tsx`: 2FA status, enable (same QR/confirm/
  recovery-code steps as enrolment), disable (password + code, hidden when
  required), regenerate recovery codes. Linked from the user menu and the
  Sidebar (everyone).

### 4.2 Admin (`app/(protected)/admin/security/page.tsx`)

Four tabs, each its own component under `components/security/`:

| Tab | Component | Content |
|---|---|---|
| Single sign-on | `SsoProvidersTab.tsx` | A card per provider: fields from §3.4, redirect URI with copy button, "Secret saved" badge instead of the secret, enable toggle, delete. |
| Two-factor & sign-in | `SecurityPolicyTab.tsx` | Role checkboxes for "Require 2FA"; "Require SSO" toggle with the break-glass note; disabled when no provider is enabled. |
| Custom roles | `CustomRolesTab.tsx` | List with user counts; create/edit dialog with the permission picker grouped by `group`; delete with confirmation. |
| Users | `SecurityUsersTab.tsx` | Search, table (email, fixed role, custom roles, 2FA, SSO), assign roles dialog, "Reset 2FA" with confirmation. |

### 4.3 Permission-aware navigation

- `lib/permission-paths.ts` maps page paths to the permission that unlocks
  them for a custom-role holder, e.g. `/admin/departments → org.manage`. A path
  is listed only if every API call the page makes is covered by that
  permission (§1.4); the implementer checks each page's calls.
- `Sidebar.tsx`: an item or child is shown when `hasRole(...item.roles)` or
  `hasPermission(permissionForPath(item.href))`. A parent group is shown when
  any child is. The "Security" admin entry and "My security" entry are added as
  one block.
- `app/(protected)/admin/layout.tsx`: allows `isAdmin` or a user who holds the
  permission for the current path; `/admin/security` stays admin-only.

---

## 5. Security notes

- **Tenant boundary.** Every lookup in the SSO flow is scoped by the tenant
  resolved at `start` and stored in `SsoLoginState`. The callback never takes a
  tenant from the query.
- **No account enumeration.** `/auth/sso/providers` only reveals which
  providers a tenant code has. `no_account` vs `domain_not_allowed` is visible
  only to someone who already proved control of that IdP account.
- **Microsoft email claims** are not verified by Microsoft in general. Trust is
  scoped to the directory the tenant admin configured (`tid` check), which the
  tenant controls. After the first login the binding is by `sub`, so a later
  email change at the IdP cannot move a login to another user.
- **Break-glass.** SUPER_ADMIN password login is never blocked by SSO-only.
- **Step tokens** cannot be used as sessions (`typ` rejected by the strategy),
  and a session cannot be used as a step token (the step guards require `typ`).
- **Brute force.** TOTP: 5/min/IP plus 5 attempts per challenge; a new
  challenge requires the password again, which is itself limited to 5/min/IP.
- **Encryption key.** Saving an SSO config or starting 2FA setup without
  `FIELD_ENCRYPTION_KEY` fails with the existing 500 from
  `FieldEncryptionService`; nothing is stored in plain text.
- **Logging.** Codes, secrets, id_tokens and exchange codes are never logged.

---

## 6. Testing

Backend (unit, mocked Prisma):

- `RolesGuard`: `@Roles` only (unchanged; the Wave E case), `@RequirePermissions`
  only, both, class vs method override, SUPER_ADMIN, missing user.
- `JwtStrategy` / `validateUser`: token without `typ` accepted, without
  `tokenVersion` accepted, with `typ` rejected; permissions union and
  deduplication; unknown keys dropped.
- Login state machine: the four outcomes; SSO-only refusal; SUPER_ADMIN
  break-glass; wrong password still 401 before any 2FA or SSO-only logic.
- 2FA: setup/enable/verify/disable/regenerate; replayed step rejected; attempt
  limit burns the challenge; recovery code single-use; enrol-token guard;
  disable refused when required; admin reset incl. HR_ADMIN vs SUPER_ADMIN.
- SSO (`openid-client` mocked): bad/expired/reused state; `email_verified`
  false; wrong `tid`; domain not allowed; `sub` conflict; match by identity, by
  email, auto-create linking an employee, bare auto-create, auto-create off;
  inactive user; exchange code single use and expiry; concurrent consume.
- Custom roles: CRUD validation, duplicate name, cross-tenant ids, assignment
  replace, audit calls.
- Secret leakage: responses of `/security/settings`, `/security/sso/*`, 2FA
  status and the login variants contain no `SecretEnc`, `clientSecret`,
  `codeHash` or raw TOTP secret.
- Password reset: SSO-only user gets no email but the same response; reset
  token refused for them; existing spec unchanged.
- A module-wiring spec for `SecurityModule` and the updated `AuthModule`
  (`overrideProvider(PrismaService)`, `ThrottlerModule.forRoot([])`, 30 s timeout).

Frontend: login steps (password → mfa, → enrol, SSO buttons, `sso_error`
messages, SSO-only collapse), SSO callback page, my-security page, the four
admin tabs, `AuthContext.hasPermission`, Sidebar and admin-layout permission
gating, `lib/api-security.ts`.

---

## 7. Workstreams (file ownership, disjoint)

**Scaffold** (one commit; frozen afterwards except where a file is also listed for a workstream below, which then owns further edits):
`backend/prisma/schema.prisma`,
`backend/prisma/migrations/<ts>_keka_wave_h1/migration.sql`,
`backend/package.json` + lock (`openid-client@5`, `otplib@12`, `qrcode`, `@types/qrcode`),
`backend/src/config/env.validation.ts` (`API_PUBLIC_URL`),
`backend/src/test/helpers/prisma-mock.ts` (one block of new models),
`backend/src/app.module.ts` (`SecurityModule`),
`backend/src/common/permissions/{permissions.ts, require-permissions.decorator.ts}` (+spec),
`backend/src/common/guards/roles.guard.ts` (+spec),
`backend/src/common/types/jwt-payload.type.ts`,
`backend/src/modules/auth/{auth.service.ts (issueSession, validateUser permissions, getProfile fields), auth.module.ts, strategies/jwt.strategy.ts}` (+ spec updates),
`backend/src/modules/auth/auth.types.ts` (step-token payloads, login result union),
`backend/src/modules/security/security.module.ts` and stub services/controllers,
`backend/src/modules/auth/{two-factor,sso}/` stub services/controllers,
`frontend/src/lib/api-security.ts`, `frontend/src/types/security.ts`,
`frontend/src/contexts/AuthContext.tsx` (`hasPermission`, `permissions` on user),
`frontend/src/lib/permission-paths.ts` (empty map + `permissionForPath`),
`frontend/src/components/layout/Sidebar.tsx` (new block + permission-aware filter),
`frontend/src/app/(protected)/admin/security/page.tsx` (tab shell).

| WS | Backend | Frontend |
|---|---|---|
| **WS-1 Permissions** | `security/custom-roles.{service,controller}.ts`, `security/security-users.{service,controller}.ts`, `security/dto/{custom-role,security-users}.dto.ts`, the 26 controllers in §1.4 (decorator lines only), specs | `components/security/{CustomRolesTab,SecurityUsersTab}.tsx`, `lib/permission-paths.ts` (entries), `app/(protected)/admin/layout.tsx`, tests |
| **WS-2 2FA & login** | `auth/auth.service.ts` (`login` only), `auth/auth.controller.ts` (login response), `auth/password-reset.service.ts`, `auth/two-factor/**`, `security/security-settings.{service,controller}.ts`, `security/dto/security-settings.dto.ts`, specs | `app/(auth)/login/page.tsx`, `components/auth/{MfaCodeStep,TotpEnrolment,RecoveryCodes}.tsx`, `app/(protected)/my-security/page.tsx`, `contexts/AuthContext.tsx` (`login` result, `completeSession`), `components/security/SecurityPolicyTab.tsx`, tests |
| **WS-3 SSO** | `auth/sso/**`, `security/sso-config.{service,controller}.ts`, `security/dto/sso-config.dto.ts`, specs | `components/auth/SsoButtons.tsx`, `app/(auth)/sso/callback/page.tsx`, `components/security/SsoProvidersTab.tsx`, tests |

Cross-workstream contracts (stubs throw `NotImplementedException` until
implemented; consumers mock them):

| Consumer | Provider | Method |
|---|---|---|
| WS-2, WS-3 | scaffold | `AuthService.issueSession(user): Promise<AuthResponseDto>` |
| WS-2 (`GET /security/settings`) | WS-3 | `SsoConfigService.listViews(tenantId): Promise<SsoProviderView[]>` |
| WS-2 (`PUT /security/settings`) | WS-3 | `SsoConfigService.hasEnabledProvider(tenantId): Promise<boolean>` |
| WS-3 (`DELETE /security/sso`) | WS-2 | `SecuritySettingsService.get(tenantId): Promise<{ requireSso, twoFactorRequiredRoles }>` |
| WS-2 login page | WS-3 | `<SsoButtons org={string \| null} onProviders={(p) => void} />` |

## Out of scope

SAML; OIDC providers other than Google and Microsoft; SCIM provisioning;
WebAuthn / passkeys; email or SMS one-time codes; 2FA requirements keyed on
custom roles; remembered devices; custom roles that remove access; moving the
follow-up controllers in §1.5; per-user session list and remote sign-out.
