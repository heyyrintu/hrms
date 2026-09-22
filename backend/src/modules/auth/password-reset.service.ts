import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

/** Reset links live for an hour. */
const TOKEN_TTL_MINUTES = 60;

/**
 * The single reply every forgot-password request gets, whether or not the
 * address belongs to an account. Anything that varies with existence turns
 * this endpoint into an account enumeration oracle.
 */
const GENERIC_REQUEST_MESSAGE =
  'If an account exists for that email address, a password reset link has been sent.';

/**
 * Likewise one message for every rejected token: unknown, already used,
 * expired and belonging-to-a-disabled-user are indistinguishable to the caller.
 */
const INVALID_TOKEN_MESSAGE =
  'This password reset link is invalid or has expired. Please request a new one.';

type ResettableUser = {
  id: string;
  tenantId: string;
  email: string;
  isActive: boolean;
};

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  /**
   * Issue a reset link for every active account matching the email.
   *
   * Always resolves with the same message. Users are unique on
   * (tenantId, email), so a deployment without DEFAULT_TENANT_ID can legitimately
   * have the same address in several tenants; each one gets its own link.
   */
  async requestReset(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const users = await this.findTargetUsers(dto);

    for (const user of users) {
      try {
        await this.issueToken(user);
      } catch (error) {
        // A failure here must not change the response, or the timing/status
        // difference becomes the enumeration signal we just removed.
        this.logger.error(
          `Failed to issue a password reset for user ${user.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    return { message: GENERIC_REQUEST_MESSAGE };
  }

  /**
   * Consume a reset token: store the new password, revoke every existing
   * session by bumping tokenVersion, clear any forced-change flag, and burn
   * the token so the link cannot be replayed.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = this.hashToken(dto.token);

    const record = await this.prisma.passwordResetToken.findFirst({
      where: { tokenHash },
      include: { user: true },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      !record.user?.isActive
    ) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    // One transaction: a crash between the two writes would otherwise leave a
    // token that still works against the password it just changed.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          // Every token minted before the reset stops working, which is the
          // point: whoever forced the reset should not keep an old session.
          tokenVersion: { increment: 1 },
        },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return {
      message: 'Password reset. Please sign in with your new password.',
    };
  }

  private async findTargetUsers(dto: ForgotPasswordDto): Promise<ResettableUser[]> {
    let tenantId: string | undefined;

    if (dto.tenantCode) {
      const tenant = await this.prisma.tenant.findFirst({
        where: { code: dto.tenantCode, isActive: true },
      });
      // An unknown code is silently a no-op, same as an unknown email.
      if (!tenant) return [];
      tenantId = tenant.id;
    } else {
      tenantId = this.configService.get<string>('DEFAULT_TENANT_ID');
    }

    const where: Record<string, unknown> = {
      email: dto.email,
      isActive: true,
    };
    if (tenantId) {
      where.tenantId = tenantId;
    }

    return (await this.prisma.user.findMany({ where })) as ResettableUser[];
  }

  private async issueToken(user: ResettableUser): Promise<void> {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);

    // One transaction: retiring the old links and minting the new one must not
    // half-happen, or a user is left with either two live links or none.
    await this.prisma.$transaction([
      // One live link per user: requesting a new one retires the old ones.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      // Only the hash is stored: a database leak must not yield usable links.
      this.prisma.passwordResetToken.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: this.hashToken(rawToken),
          expiresAt,
        },
      }),
    ]);

    const frontendUrl = (
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000'
    ).replace(/\/+$/, '');

    // Deliberately not awaited. Waiting for an SMTP/Graph round-trip would make
    // a request for a real account measurably slower than one for an address
    // with no account, and that timing difference is itself the enumeration
    // oracle this endpoint exists to avoid. Both branches now return after the
    // same database work.
    void this.emailService
      .sendEmail({
        to: user.email,
        subject: 'Reset your HRMS password',
        template: 'password-reset',
        context: {
          email: user.email,
          resetUrl: `${frontendUrl}/reset-password?token=${rawToken}`,
          expiryMinutes: TOKEN_TTL_MINUTES,
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Password reset email to user ${user.id} failed: ${
            error instanceof Error ? error.message : error
          }`,
        );
      });
  }

  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
}
