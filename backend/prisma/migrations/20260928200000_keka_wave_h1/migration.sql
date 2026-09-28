-- CreateEnum
CREATE TYPE "SsoProvider" AS ENUM ('GOOGLE', 'MICROSOFT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpPendingSecretEnc" TEXT,
ADD COLUMN     "totpSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "custom_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "permissions" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_custom_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "customRoleId" TEXT NOT NULL,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_security_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requireSso" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorRequiredRoles" "UserRole"[] DEFAULT ARRAY[]::"UserRole"[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_security_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_recovery_codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_sso_providers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "SsoProvider" NOT NULL,
    "clientId" VARCHAR(255) NOT NULL,
    "clientSecretEnc" TEXT NOT NULL,
    "entraTenantId" VARCHAR(64),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedDomains" TEXT[],
    "autoCreateUsers" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_sso_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "SsoProvider" NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_login_states" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "provider" "SsoProvider" NOT NULL,
    "stateHash" VARCHAR(64) NOT NULL,
    "nonce" VARCHAR(128) NOT NULL,
    "codeVerifier" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_login_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_exchange_codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sso_exchange_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "custom_roles_tenantId_idx" ON "custom_roles"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_roles_tenantId_name_key" ON "custom_roles"("tenantId", "name");

-- CreateIndex
CREATE INDEX "user_custom_roles_tenantId_idx" ON "user_custom_roles"("tenantId");

-- CreateIndex
CREATE INDEX "user_custom_roles_customRoleId_idx" ON "user_custom_roles"("customRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_custom_roles_userId_customRoleId_key" ON "user_custom_roles"("userId", "customRoleId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_security_settings_tenantId_key" ON "tenant_security_settings"("tenantId");

-- CreateIndex
CREATE INDEX "user_recovery_codes_userId_idx" ON "user_recovery_codes"("userId");

-- CreateIndex
CREATE INDEX "user_recovery_codes_tenantId_idx" ON "user_recovery_codes"("tenantId");

-- CreateIndex
CREATE INDEX "mfa_challenges_userId_idx" ON "mfa_challenges"("userId");

-- CreateIndex
CREATE INDEX "mfa_challenges_tenantId_idx" ON "mfa_challenges"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_sso_providers_tenantId_provider_key" ON "tenant_sso_providers"("tenantId", "provider");

-- CreateIndex
CREATE INDEX "user_identities_tenantId_idx" ON "user_identities"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_tenantId_provider_subject_key" ON "user_identities"("tenantId", "provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_userId_provider_key" ON "user_identities"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "sso_login_states_stateHash_key" ON "sso_login_states"("stateHash");

-- CreateIndex
CREATE INDEX "sso_login_states_tenantId_idx" ON "sso_login_states"("tenantId");

-- CreateIndex
CREATE INDEX "sso_login_states_expiresAt_idx" ON "sso_login_states"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "sso_exchange_codes_codeHash_key" ON "sso_exchange_codes"("codeHash");

-- CreateIndex
CREATE INDEX "sso_exchange_codes_tenantId_idx" ON "sso_exchange_codes"("tenantId");

-- CreateIndex
CREATE INDEX "sso_exchange_codes_expiresAt_idx" ON "sso_exchange_codes"("expiresAt");

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_custom_roles" ADD CONSTRAINT "user_custom_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_custom_roles" ADD CONSTRAINT "user_custom_roles_customRoleId_fkey" FOREIGN KEY ("customRoleId") REFERENCES "custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_security_settings" ADD CONSTRAINT "tenant_security_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_sso_providers" ADD CONSTRAINT "tenant_sso_providers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

