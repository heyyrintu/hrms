import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { TwoFactorService } from './two-factor.service';
import { TotpService } from './totp.service';
import { RecoveryCodesService } from './recovery-codes.service';
import { StepTokenService } from './step-token.service';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { FieldEncryptionService } from '../../../common/crypto/field-encryption.service';
import { AuditService } from '../../audit/audit.service';
import { createMockPrismaService } from '../../../test/helpers';

jest.mock('bcrypt');
const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('TwoFactorService', () => {
  let service: TwoFactorService;
  let prisma: any;
  let totp: { verify: jest.Mock; generateSecret: jest.Mock; keyUri: jest.Mock; qrDataUrl: jest.Mock };
  let recoveryCodes: {
    generate: jest.Mock;
    hash: jest.Mock;
    normalise: jest.Mock;
    looksLikeRecoveryCode: jest.Mock;
  };
  let stepTokenService: { verify: jest.Mock };
  let authService: { issueSession: jest.Mock };
  let fieldEncryption: { encrypt: jest.Mock; decrypt: jest.Mock };
  let audit: { log: jest.Mock };

  const baseUser = {
    id: 'user-1',
    email: 'jane@acme.test',
    tenantId: 'tenant-1',
    role: 'EMPLOYEE',
    isActive: true,
    passwordHash: 'hashed-pw',
    tokenVersion: 1,
    totpSecretEnc: null,
    totpPendingSecretEnc: null,
    totpEnabledAt: null,
    totpLastStep: null,
  };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    totp = {
      verify: jest.fn(),
      generateSecret: jest.fn().mockReturnValue('RAWSECRET'),
      keyUri: jest.fn().mockReturnValue('otpauth://totp/x'),
      qrDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,xyz'),
    };
    recoveryCodes = {
      generate: jest.fn().mockReturnValue({ plain: ['AAAAA-BBBBB'], hashes: ['hash1'] }),
      hash: jest.fn((c: string) => `hash-of-${c}`),
      normalise: jest.fn((c: string) => c.toLowerCase()),
      looksLikeRecoveryCode: jest.fn((c: string) => c.replace(/[^a-z0-9]/gi, '').length === 10),
    };
    stepTokenService = { verify: jest.fn() };
    authService = { issueSession: jest.fn().mockResolvedValue({ accessToken: 'tok', user: {} }) };
    fieldEncryption = {
      encrypt: jest.fn((v: string) => `enc:${v}`),
      decrypt: jest.fn((v: string) => v.replace(/^enc:/, '')),
    };
    audit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        { provide: PrismaService, useValue: prisma },
        { provide: TotpService, useValue: totp },
        { provide: RecoveryCodesService, useValue: recoveryCodes },
        { provide: StepTokenService, useValue: stepTokenService },
        { provide: AuthService, useValue: authService },
        { provide: FieldEncryptionService, useValue: fieldEncryption },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<TwoFactorService>(TwoFactorService);
    (mockBcrypt.compare as jest.Mock).mockReset();
  });

  describe('verify', () => {
    const mfaPayload = { typ: 'mfa', sub: 'user-1', tenantId: 'tenant-1', cid: 'challenge-1' };
    const challenge = {
      id: 'challenge-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      attempts: 0,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it('consumes the challenge and issues a session on a correct TOTP code', async () => {
      stepTokenService.verify.mockReturnValue(mfaPayload);
      prisma.mfaChallenge.findFirst.mockResolvedValue(challenge);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET', totpLastStep: 10 });
      totp.verify.mockReturnValue(11);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.mfaChallenge.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verify('mfa-token', '123456');

      expect(fieldEncryption.decrypt).toHaveBeenCalledWith('enc:SECRET');
      expect(totp.verify).toHaveBeenCalledWith('SECRET', '123456', 10);
      expect(prisma.mfaChallenge.updateMany).toHaveBeenCalledWith({
        where: { id: 'challenge-1', consumedAt: null },
        data: { consumedAt: expect.any(Date) },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpLastStep: 11 },
      });
      expect(authService.issueSession).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'tok', user: {} });
    });

    it('consumes the challenge and an unused recovery code, and issues a session', async () => {
      stepTokenService.verify.mockReturnValue(mfaPayload);
      prisma.mfaChallenge.findFirst.mockResolvedValue(challenge);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      prisma.userRecoveryCode.findFirst.mockResolvedValue({ id: 'rc-1', usedAt: null });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.mfaChallenge.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.verify('mfa-token', 'ABCDE-FGHJK');

      expect(prisma.userRecoveryCode.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', tenantId: 'tenant-1', codeHash: expect.any(String), usedAt: null },
      });
      expect(prisma.userRecoveryCode.update).toHaveBeenCalledWith({
        where: { id: 'rc-1' },
        data: { usedAt: expect.any(Date) },
      });
      expect(authService.issueSession).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'tok', user: {} });
    });

    it('accepts a recovery code typed with different casing/spacing once (Review Focus 3)', async () => {
      stepTokenService.verify.mockReturnValue(mfaPayload);
      prisma.mfaChallenge.findFirst.mockResolvedValue(challenge);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      prisma.userRecoveryCode.findFirst.mockResolvedValue({ id: 'rc-1', usedAt: null });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.mfaChallenge.updateMany.mockResolvedValue({ count: 1 });

      await service.verify('mfa-token', 'abcde fghjk');

      expect(recoveryCodes.hash).toHaveBeenCalledWith('abcde fghjk');
    });

    it('rejects a wrong TOTP code and increments attempts', async () => {
      stepTokenService.verify.mockReturnValue(mfaPayload);
      prisma.mfaChallenge.findFirst.mockResolvedValue(challenge);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      totp.verify.mockReturnValue(null);

      await expect(service.verify('mfa-token', '000000')).rejects.toThrow(UnauthorizedException);
      expect(prisma.mfaChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { attempts: { increment: 1 } },
      });
    });

    it('consumes the challenge on the 5th wrong attempt, and the 6th call (even with the right code) is 401', async () => {
      stepTokenService.verify.mockReturnValue(mfaPayload);
      prisma.mfaChallenge.findFirst.mockResolvedValue({ ...challenge, attempts: 4 });
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      totp.verify.mockReturnValue(null);

      await expect(service.verify('mfa-token', '000000')).rejects.toThrow(UnauthorizedException);
      expect(prisma.mfaChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { attempts: { increment: 1 }, consumedAt: expect.any(Date) },
      });

      // 6th call: the challenge is now consumed.
      prisma.mfaChallenge.findFirst.mockResolvedValue({
        ...challenge,
        attempts: 5,
        consumedAt: new Date(),
      });
      totp.verify.mockReturnValue(42); // even the right code now
      await expect(service.verify('mfa-token', '111111')).rejects.toThrow(UnauthorizedException);
    });

    it('401s when the challenge does not exist, is expired, or belongs to another user/tenant', async () => {
      stepTokenService.verify.mockReturnValue(mfaPayload);
      prisma.mfaChallenge.findFirst.mockResolvedValue(null);

      await expect(service.verify('mfa-token', '123456')).rejects.toThrow(UnauthorizedException);
    });

    it('401s when the conditional consume loses a race (count !== 1)', async () => {
      stepTokenService.verify.mockReturnValue(mfaPayload);
      prisma.mfaChallenge.findFirst.mockResolvedValue(challenge);
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      totp.verify.mockReturnValue(11);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.mfaChallenge.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.verify('mfa-token', '123456')).rejects.toThrow(UnauthorizedException);
      expect(authService.issueSession).not.toHaveBeenCalled();
    });
  });

  describe('setup', () => {
    const actor = { userId: 'user-1', email: 'jane@acme.test', tenantId: 'tenant-1', role: 'EMPLOYEE' } as any;

    it('encrypts a new secret into totpPendingSecretEnc and returns the QR', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Acme Corp' });

      const result = await service.setup(actor);

      expect(totp.keyUri).toHaveBeenCalledWith('jane@acme.test', 'Acme Corp', 'RAWSECRET');
      expect(fieldEncryption.encrypt).toHaveBeenCalledWith('RAWSECRET');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpPendingSecretEnc: 'enc:RAWSECRET' },
      });
      expect(result).toEqual({ otpauthUrl: 'otpauth://totp/x', qrCodeDataUrl: 'data:image/png;base64,xyz' });
    });

    it('overwrites an earlier pending secret when called twice (Review Focus 4)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpPendingSecretEnc: 'enc:OLDSECRET' });
      prisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1', name: 'Acme Corp' });
      totp.generateSecret.mockReturnValue('NEWSECRET');

      await service.setup(actor);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { totpPendingSecretEnc: 'enc:NEWSECRET' },
      });
    });

    it('400s when 2FA is already enabled', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpEnabledAt: new Date() });

      await expect(service.setup(actor)).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('enable', () => {
    const actor = { userId: 'user-1', email: 'jane@acme.test', tenantId: 'tenant-1', role: 'EMPLOYEE' } as any;

    it('promotes the pending secret, replaces recovery codes and returns a session (Review Focus 4)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpPendingSecretEnc: 'enc:NEWSECRET' });
      totp.verify.mockReturnValue(7);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.user.update.mockResolvedValue({ ...baseUser, totpEnabledAt: new Date() });

      const result = await service.enable(actor, '654321');

      expect(totp.verify).toHaveBeenCalledWith('NEWSECRET', '654321', null);
      expect(prisma.userRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(prisma.userRecoveryCode.createMany).toHaveBeenCalledWith({
        data: [{ tenantId: 'tenant-1', userId: 'user-1', codeHash: 'hash1' }],
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          totpSecretEnc: 'enc:NEWSECRET',
          totpPendingSecretEnc: null,
          totpEnabledAt: expect.any(Date),
          totpLastStep: 7,
          tokenVersion: { increment: 1 },
        },
      });
      expect(authService.issueSession).toHaveBeenCalled();
      expect(result).toEqual({ recoveryCodes: ['AAAAA-BBBBB'], session: { accessToken: 'tok', user: {} } });
    });

    it('a code generated for the first secret fails once setup ran again for a second secret', async () => {
      // The pending secret in the DB is already the newer one; a code from the
      // old secret does not validate against it.
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpPendingSecretEnc: 'enc:NEWSECRET' });
      totp.verify.mockReturnValue(null);

      await expect(service.enable(actor, '000000')).rejects.toThrow(UnauthorizedException);
      expect(prisma.userRecoveryCode.deleteMany).not.toHaveBeenCalled();
    });

    it('400s without a pending secret', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpPendingSecretEnc: null });

      await expect(service.enable(actor, '123456')).rejects.toThrow(BadRequestException);
    });
  });

  describe('disable', () => {
    const actor = { userId: 'user-1', email: 'jane@acme.test', tenantId: 'tenant-1', role: 'EMPLOYEE' } as any;

    it('clears TOTP state, bumps tokenVersion and returns a session', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET', totpLastStep: 5 });
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue(null);
      totp.verify.mockReturnValue(6);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));
      prisma.user.update.mockResolvedValue({ ...baseUser, totpEnabledAt: null });

      const result = await service.disable(actor, 'correct-password', '123456');

      expect(mockBcrypt.compare).toHaveBeenCalledWith('correct-password', baseUser.passwordHash);
      expect(prisma.userRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          totpSecretEnc: null,
          totpPendingSecretEnc: null,
          totpEnabledAt: null,
          totpLastStep: null,
          tokenVersion: { increment: 1 },
        },
      });
      expect(result).toEqual({ accessToken: 'tok', user: {} });
    });

    it('401s on a wrong password before checking anything else', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.disable(actor, 'wrong', '123456')).rejects.toThrow(UnauthorizedException);
      expect(prisma.tenantSecuritySettings.findUnique).not.toHaveBeenCalled();
    });

    it('403s when the role requires 2FA', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({
        requireSso: false,
        twoFactorRequiredRoles: ['EMPLOYEE'],
      });

      await expect(service.disable(actor, 'correct-password', '123456')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('401s on a wrong TOTP code', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      (mockBcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue(null);
      totp.verify.mockReturnValue(null);

      await expect(service.disable(actor, 'correct-password', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('regenerateRecoveryCodes', () => {
    const actor = { userId: 'user-1', email: 'jane@acme.test', tenantId: 'tenant-1', role: 'EMPLOYEE' } as any;

    it('replaces all recovery codes after a correct TOTP code', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET', totpLastStep: 3 });
      totp.verify.mockReturnValue(4);
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      const result = await service.regenerateRecoveryCodes(actor, '123456');

      expect(prisma.userRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(prisma.userRecoveryCode.createMany).toHaveBeenCalled();
      expect(result).toEqual({ recoveryCodes: ['AAAAA-BBBBB'] });
    });

    it('401s on a wrong TOTP code', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: 'enc:SECRET' });
      totp.verify.mockReturnValue(null);

      await expect(service.regenerateRecoveryCodes(actor, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('400s when 2FA is not enabled', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, totpSecretEnc: null });

      await expect(service.regenerateRecoveryCodes(actor, '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('status', () => {
    const actor = { userId: 'user-1', email: 'jane@acme.test', tenantId: 'tenant-1', role: 'EMPLOYEE' } as any;

    it('reports enabled state, required flag and remaining recovery codes', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        totpEnabledAt: new Date('2026-09-01T00:00:00Z'),
      });
      prisma.tenantSecuritySettings.findUnique.mockResolvedValue({
        requireSso: false,
        twoFactorRequiredRoles: ['EMPLOYEE'],
      });
      prisma.userRecoveryCode.count.mockResolvedValue(7);

      const result = await service.status(actor);

      expect(result).toEqual({
        enabled: true,
        enabledAt: new Date('2026-09-01T00:00:00Z'),
        required: true,
        recoveryCodesRemaining: 7,
      });
    });
  });

  describe('resetForUser', () => {
    const hrAdminActor = { userId: 'admin-1', tenantId: 'tenant-1', role: 'HR_ADMIN' } as any;
    const superAdminActor = { userId: 'admin-1', tenantId: 'tenant-1', role: 'SUPER_ADMIN' } as any;

    it('clears the target user TOTP state, bumps tokenVersion and audits', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', tenantId: 'tenant-1', role: 'EMPLOYEE' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      const result = await service.resetForUser('tenant-1', 'user-2', hrAdminActor);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-2', tenantId: 'tenant-1' },
      });
      expect(prisma.userRecoveryCode.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-2' } });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-2' },
        data: {
          totpSecretEnc: null,
          totpPendingSecretEnc: null,
          totpEnabledAt: null,
          totpLastStep: null,
          tokenVersion: { increment: 1 },
        },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          entityType: 'UserTwoFactor',
          entityId: 'user-2',
          newValues: { reset: true },
        }),
      );
      expect(result.message).toEqual(expect.any(String));
    });

    it('404s for a user outside the tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.resetForUser('tenant-1', 'ghost', hrAdminActor)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403s when an HR_ADMIN tries to reset a SUPER_ADMIN', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', tenantId: 'tenant-1', role: 'SUPER_ADMIN' });

      await expect(service.resetForUser('tenant-1', 'user-2', hrAdminActor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows a SUPER_ADMIN to reset another SUPER_ADMIN', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-2', tenantId: 'tenant-1', role: 'SUPER_ADMIN' });
      prisma.$transaction.mockImplementation(async (fn: any) => fn(prisma));

      await expect(
        service.resetForUser('tenant-1', 'user-2', superAdminActor),
      ).resolves.toEqual({ message: expect.any(String) });
    });
  });
});
