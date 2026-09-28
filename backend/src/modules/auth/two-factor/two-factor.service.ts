import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuditAction, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AuthService } from '../auth.service';
import { LoginResult } from '../auth.types';
import { TotpService } from './totp.service';
import { RecoveryCodesService } from './recovery-codes.service';
import { StepTokenService } from './step-token.service';

const MAX_MFA_ATTEMPTS = 5;
const INVALID_CODE_MESSAGE = 'Invalid code';

/**
 * Two-factor enrolment, verification and admin reset.
 * Owned by WS-2 (plan Tasks 2.4 and 2.5); routes live in TwoFactorController.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
    private readonly recoveryCodes: RecoveryCodesService,
    private readonly stepTokenService: StepTokenService,
    private readonly authService: AuthService,
    private readonly fieldEncryption: FieldEncryptionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Verify the second factor for a login that stopped at an MfaChallenge.
   * Accepts a 6-digit TOTP code or a single-use recovery code.
   */
  async verify(mfaToken: string, code: string): Promise<LoginResult> {
    const payload = this.stepTokenService.verify(mfaToken, 'mfa');

    const challenge = await this.prisma.mfaChallenge.findFirst({
      where: { id: payload.cid, userId: payload.sub, tenantId: payload.tenantId },
    });
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.attempts >= MAX_MFA_ATTEMPTS
    ) {
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    }

    const isTotpShaped = /^\d{6}$/.test(code);

    if (isTotpShaped) {
      const step = user.totpSecretEnc
        ? this.totp.verify(this.fieldEncryption.decrypt(user.totpSecretEnc), code, user.totpLastStep)
        : null;
      if (step === null) {
        await this.recordFailedAttempt(challenge.id, challenge.attempts);
        throw new UnauthorizedException(INVALID_CODE_MESSAGE);
      }

      await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.mfaChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (consumed.count !== 1) {
          throw new UnauthorizedException(INVALID_CODE_MESSAGE);
        }
        await tx.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
      });

      return this.authService.issueSession(user);
    }

    if (!this.recoveryCodes.looksLikeRecoveryCode(code)) {
      await this.recordFailedAttempt(challenge.id, challenge.attempts);
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    }

    const recoveryCode = await this.prisma.userRecoveryCode.findFirst({
      where: {
        userId: user.id,
        tenantId: payload.tenantId,
        codeHash: this.recoveryCodes.hash(code),
        usedAt: null,
      },
    });
    if (!recoveryCode) {
      await this.recordFailedAttempt(challenge.id, challenge.attempts);
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    }

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.mfaChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException(INVALID_CODE_MESSAGE);
      }
      await tx.userRecoveryCode.update({
        where: { id: recoveryCode.id },
        data: { usedAt: new Date() },
      });
    });

    return this.authService.issueSession(user);
  }

  private async recordFailedAttempt(challengeId: string, currentAttempts: number): Promise<void> {
    const attempts = currentAttempts + 1;
    const data: { attempts: { increment: number }; consumedAt?: Date } = {
      attempts: { increment: 1 },
    };
    if (attempts >= MAX_MFA_ATTEMPTS) {
      data.consumedAt = new Date();
    }
    await this.prisma.mfaChallenge.update({ where: { id: challengeId }, data });
  }

  /** Start (or restart) TOTP enrolment. Only the newest pending secret is live. */
  async setup(actor: AuthenticatedUser): Promise<{ otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.loadUser(actor.userId);
    if (user.totpEnabledAt) {
      throw new BadRequestException('Two-factor authentication is already enabled');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId } });
    const issuer = tenant?.name ?? 'HRMS';

    const secret = this.totp.generateSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpPendingSecretEnc: this.fieldEncryption.encrypt(secret) },
    });

    const otpauthUrl = this.totp.keyUri(user.email, issuer, secret);
    const qrCodeDataUrl = await this.totp.qrDataUrl(otpauthUrl);
    return { otpauthUrl, qrCodeDataUrl };
  }

  /** Confirm the pending secret and turn 2FA on. */
  async enable(
    actor: AuthenticatedUser,
    code: string,
  ): Promise<{ recoveryCodes: string[]; session: LoginResult }> {
    const user = await this.loadUser(actor.userId);
    if (!user.totpPendingSecretEnc) {
      throw new BadRequestException('Start two-factor setup first');
    }

    const secret = this.fieldEncryption.decrypt(user.totpPendingSecretEnc);
    const step = this.totp.verify(secret, code, null);
    if (step === null) {
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    }

    const { plain, hashes } = this.recoveryCodes.generate();

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      await tx.userRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.userRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ tenantId: user.tenantId, userId: user.id, codeHash })),
      });
      return tx.user.update({
        where: { id: user.id },
        data: {
          totpSecretEnc: this.fieldEncryption.encrypt(secret),
          totpPendingSecretEnc: null,
          totpEnabledAt: new Date(),
          totpLastStep: step,
          tokenVersion: { increment: 1 },
        },
      });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entityType: 'UserTwoFactor',
      entityId: user.id,
      newValues: { enabled: true },
    });

    const session = await this.authService.issueSession(updatedUser);
    return { recoveryCodes: plain, session };
  }

  /** Turn 2FA off. Refused for a role the tenant now requires it for. */
  async disable(actor: AuthenticatedUser, password: string, code: string): Promise<LoginResult> {
    const user = await this.loadUser(actor.userId);

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const settings = await this.prisma.tenantSecuritySettings.findUnique({
      where: { tenantId: user.tenantId },
    });
    if ((settings?.twoFactorRequiredRoles ?? []).includes(user.role)) {
      throw new ForbiddenException('Two-factor authentication is required for your role');
    }

    if (!user.totpSecretEnc) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }
    const secret = this.fieldEncryption.decrypt(user.totpSecretEnc);
    const step = this.totp.verify(secret, code, user.totpLastStep);
    if (step === null) {
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    }

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      await tx.userRecoveryCode.deleteMany({ where: { userId: user.id } });
      return tx.user.update({
        where: { id: user.id },
        data: {
          totpSecretEnc: null,
          totpPendingSecretEnc: null,
          totpEnabledAt: null,
          totpLastStep: null,
          tokenVersion: { increment: 1 },
        },
      });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: AuditAction.UPDATE,
      entityType: 'UserTwoFactor',
      entityId: user.id,
      newValues: { enabled: false },
    });

    return this.authService.issueSession(updatedUser);
  }

  /** Replace every recovery code after a fresh TOTP check. */
  async regenerateRecoveryCodes(
    actor: AuthenticatedUser,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const user = await this.loadUser(actor.userId);
    if (!user.totpSecretEnc) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const secret = this.fieldEncryption.decrypt(user.totpSecretEnc);
    const step = this.totp.verify(secret, code, user.totpLastStep);
    if (step === null) {
      throw new UnauthorizedException(INVALID_CODE_MESSAGE);
    }

    const { plain, hashes } = this.recoveryCodes.generate();
    await this.prisma.$transaction(async (tx) => {
      await tx.userRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.userRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ tenantId: user.tenantId, userId: user.id, codeHash })),
      });
      await tx.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
    });

    return { recoveryCodes: plain };
  }

  async status(actor: AuthenticatedUser): Promise<{
    enabled: boolean;
    enabledAt: Date | null;
    required: boolean;
    recoveryCodesRemaining: number;
  }> {
    const user = await this.loadUser(actor.userId);
    const settings = await this.prisma.tenantSecuritySettings.findUnique({
      where: { tenantId: user.tenantId },
    });
    const recoveryCodesRemaining = await this.prisma.userRecoveryCode.count({
      where: { userId: user.id, usedAt: null },
    });

    return {
      enabled: !!user.totpEnabledAt,
      enabledAt: user.totpEnabledAt,
      required: (settings?.twoFactorRequiredRoles ?? []).includes(user.role),
      recoveryCodesRemaining,
    };
  }

  /**
   * Admin reset: clears the user's TOTP secret and recovery codes and signs
   * out their sessions. Used by POST /security/users/:id/2fa/reset.
   */
  async resetForUser(
    tenantId: string,
    targetUserId: string,
    actor: AuthenticatedUser,
  ): Promise<{ message: string }> {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (target.role === UserRole.SUPER_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a SUPER_ADMIN can reset another SUPER_ADMIN');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userRecoveryCode.deleteMany({ where: { userId: target.id } });
      await tx.user.update({
        where: { id: target.id },
        data: {
          totpSecretEnc: null,
          totpPendingSecretEnc: null,
          totpEnabledAt: null,
          totpLastStep: null,
          tokenVersion: { increment: 1 },
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId: actor.userId,
      action: AuditAction.UPDATE,
      entityType: 'UserTwoFactor',
      entityId: target.id,
      newValues: { reset: true },
    });

    return { message: 'Two-factor authentication has been reset for this user.' };
  }

  private async loadUser(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return user;
  }
}
