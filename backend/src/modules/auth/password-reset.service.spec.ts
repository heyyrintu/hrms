import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PasswordResetService } from './password-reset.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { createMockPrismaService, createMockEmailService } from '../../test/helpers';

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

/**
 * The reset email is dispatched without being awaited, so the request path
 * takes the same time whether or not the address has an account. Let the
 * pending microtasks settle before asserting on it.
 */
const flush = () => new Promise((resolve) => setImmediate(resolve));

const activeUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  email: 'jane@acme.test',
  isActive: true,
  passwordHash: 'old-hash',
  tokenVersion: 3,
  mustChangePassword: true,
};

describe('PasswordResetService', () => {
  let service: PasswordResetService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let email: ReturnType<typeof createMockEmailService>;

  const build = async (configValues: Record<string, string | undefined>) => {
    prisma = createMockPrismaService();
    email = createMockEmailService();
    const config = {
      get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PasswordResetService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: email },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<PasswordResetService>(PasswordResetService);
  };

  beforeEach(async () => {
    await build({
      DEFAULT_TENANT_ID: 'tenant-1',
      FRONTEND_URL: 'https://hr.acme.test',
    });
  });

  describe('requestReset', () => {
    it('returns the generic message and issues nothing for an unknown email', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.requestReset({ email: 'nobody@acme.test' });

      expect(result.message).toEqual(expect.any(String));
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(email.sendEmail).not.toHaveBeenCalled();
    });

    it('scopes the lookup to DEFAULT_TENANT_ID when no tenantCode is given', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

      await service.requestReset({ email: 'jane@acme.test' });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { email: 'jane@acme.test', isActive: true, tenantId: 'tenant-1' },
      });
    });

    it('stores only the sha256 hash of the raw token and mails the raw token', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([activeUser]);
      (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue({ id: 'tok-1' });

      const before = Date.now();
      await service.requestReset({ email: 'jane@acme.test' });
      await flush();

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      const createArg = (prisma.passwordResetToken.create as jest.Mock).mock.calls[0][0];
      expect(createArg.data.tenantId).toBe('tenant-1');
      expect(createArg.data.userId).toBe('user-1');
      expect(createArg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);

      // 60-minute expiry.
      const ttl = createArg.data.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(59 * 60_000);
      expect(ttl).toBeLessThanOrEqual(61 * 60_000);

      expect(email.sendEmail).toHaveBeenCalledTimes(1);
      const mail = (email.sendEmail as jest.Mock).mock.calls[0][0];
      expect(mail.to).toBe('jane@acme.test');
      expect(mail.template).toBe('password-reset');

      const resetUrl: string = mail.context.resetUrl;
      expect(
        resetUrl.startsWith('https://hr.acme.test/reset-password?token='),
      ).toBe(true);
      const rawToken = new URL(resetUrl).searchParams.get('token') as string;
      expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
      // The stored hash must be the hash of the token that was emailed.
      expect(createArg.data.tokenHash).toBe(sha256(rawToken));
      // The raw token itself is never persisted.
      expect(JSON.stringify(createArg.data)).not.toContain(rawToken);
    });

    it('invalidates prior unused tokens before issuing a new one', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([activeUser]);
      (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue({ id: 'tok-2' });

      await service.requestReset({ email: 'jane@acme.test' });

      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', usedAt: null },
        data: { usedAt: expect.any(Date) },
      });
      // Retiring the old links and minting the new one go in one transaction.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(Array.isArray((prisma.$transaction as jest.Mock).mock.calls[0][0])).toBe(true);
    });

    it('resolves an explicit tenantCode and issues nothing when the code is unknown', async () => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue(null);

      await service.requestReset({ email: 'jane@acme.test', tenantCode: 'nope' });

      expect(prisma.tenant.findFirst).toHaveBeenCalledWith({
        where: { code: 'nope', isActive: true },
      });
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the resolved tenant when tenantCode is given', async () => {
      (prisma.tenant.findFirst as jest.Mock).mockResolvedValue({ id: 'tenant-9' });
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);

      await service.requestReset({ email: 'jane@acme.test', tenantCode: 'acme' });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { email: 'jane@acme.test', isActive: true, tenantId: 'tenant-9' },
      });
    });

    it('mails every matching active user when no default tenant is configured', async () => {
      await build({ DEFAULT_TENANT_ID: undefined, FRONTEND_URL: undefined });
      (prisma.user.findMany as jest.Mock).mockResolvedValue([
        activeUser,
        { ...activeUser, id: 'user-2', tenantId: 'tenant-2' },
      ]);
      (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue({ id: 'tok' });

      await service.requestReset({ email: 'jane@acme.test' });
      await flush();

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { email: 'jane@acme.test', isActive: true },
      });
      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(2);
      expect(email.sendEmail).toHaveBeenCalledTimes(2);
      // Falls back to localhost when FRONTEND_URL is unset.
      const mail = (email.sendEmail as jest.Mock).mock.calls[0][0];
      expect(mail.context.resetUrl).toContain(
        'http://localhost:3000/reset-password?token=',
      );
    });

    it('never lets an email failure leak the existence of the account', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([activeUser]);
      (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue({ id: 'tok-3' });
      (email.sendEmail as jest.Mock).mockRejectedValue(new Error('smtp down'));

      await expect(
        service.requestReset({ email: 'jane@acme.test' }),
      ).resolves.toEqual({ message: expect.any(String) });
      // The rejection is handled inside the service, not left unhandled.
      await flush();
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('does not wait for the mail transport before answering', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([activeUser]);
      (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue({ id: 'tok-5' });
      // A transport that never settles must not hold the response open, or the
      // extra latency for a real account is itself an enumeration oracle.
      (email.sendEmail as jest.Mock).mockReturnValue(new Promise(() => {}));

      await expect(
        service.requestReset({ email: 'jane@acme.test' }),
      ).resolves.toEqual({ message: expect.any(String) });
      expect(email.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('returns the identical message for known and unknown emails', async () => {
      (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
      const unknown = await service.requestReset({ email: 'nobody@acme.test' });

      (prisma.user.findMany as jest.Mock).mockResolvedValue([activeUser]);
      (prisma.passwordResetToken.create as jest.Mock).mockResolvedValue({ id: 'tok-4' });
      const known = await service.requestReset({ email: 'jane@acme.test' });

      expect(known).toEqual(unknown);
    });
  });

  describe('resetPassword', () => {
    const rawToken = 'a'.repeat(64);
    const hash = sha256(rawToken);

    it('rejects an unknown token', async () => {
      (prisma.passwordResetToken.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resetPassword({ token: rawToken, newPassword: 'newpassword1' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.passwordResetToken.findFirst).toHaveBeenCalledWith({
        where: { tokenHash: hash },
        include: { user: true },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an already-used token', async () => {
      (prisma.passwordResetToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'tok-1',
        tokenHash: hash,
        usedAt: new Date('2026-09-20T12:00:00Z'),
        expiresAt: new Date(Date.now() + 60_000),
        user: activeUser,
      });

      await expect(
        service.resetPassword({ token: rawToken, newPassword: 'newpassword1' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects an expired token', async () => {
      (prisma.passwordResetToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'tok-1',
        tokenHash: hash,
        usedAt: null,
        expiresAt: new Date(Date.now() - 1_000),
        user: activeUser,
      });

      await expect(
        service.resetPassword({ token: rawToken, newPassword: 'newpassword1' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a token belonging to a deactivated user', async () => {
      (prisma.passwordResetToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'tok-1',
        tokenHash: hash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { ...activeUser, isActive: false },
      });

      await expect(
        service.resetPassword({ token: rawToken, newPassword: 'newpassword1' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('stores the new hash, bumps tokenVersion, clears mustChangePassword and burns the token', async () => {
      (prisma.passwordResetToken.findFirst as jest.Mock).mockResolvedValue({
        id: 'tok-1',
        tokenHash: hash,
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: activeUser,
      });
      (prisma.user.update as jest.Mock).mockResolvedValue({ id: 'user-1' });
      (prisma.passwordResetToken.update as jest.Mock).mockResolvedValue({ id: 'tok-1' });

      const result = await service.resetPassword({
        token: rawToken,
        newPassword: 'newpassword1',
      });

      expect(result.message).toEqual(expect.any(String));

      const updateArg = (prisma.user.update as jest.Mock).mock.calls[0][0];
      expect(updateArg.where).toEqual({ id: 'user-1' });
      expect(updateArg.data.mustChangePassword).toBe(false);
      expect(updateArg.data.tokenVersion).toEqual({ increment: 1 });
      expect(updateArg.data.passwordHash).not.toBe('newpassword1');
      await expect(
        bcrypt.compare('newpassword1', updateArg.data.passwordHash),
      ).resolves.toBe(true);

      expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
        where: { id: 'tok-1' },
        data: { usedAt: expect.any(Date) },
      });

      // Both writes go in one transaction: a crash between them would leave a
      // token that still works against the password it just changed.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(
        ((prisma.$transaction as jest.Mock).mock.calls[0][0] as unknown[]).length,
      ).toBe(2);
    });
  });
});
