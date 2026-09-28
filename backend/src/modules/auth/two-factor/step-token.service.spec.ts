import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { StepTokenService } from './step-token.service';

describe('StepTokenService', () => {
  let service: StepTokenService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret' })],
      providers: [StepTokenService],
    }).compile();

    service = module.get<StepTokenService>(StepTokenService);
    jwtService = module.get<JwtService>(JwtService);
  });

  describe('mfa tokens', () => {
    it('signs and verifies an mfa step token', () => {
      const token = service.signMfa({ sub: 'user-1', tenantId: 'tenant-1', cid: 'challenge-1' });
      const payload = service.verify(token, 'mfa');

      expect(payload).toMatchObject({
        typ: 'mfa',
        sub: 'user-1',
        tenantId: 'tenant-1',
        cid: 'challenge-1',
      });
    });

    it('expires after 5 minutes', () => {
      const token = service.signMfa({ sub: 'user-1', tenantId: 'tenant-1', cid: 'challenge-1' });
      const decoded = jwtService.decode(token) as { exp: number; iat: number };
      expect(decoded.exp - decoded.iat).toBe(5 * 60);
    });

    it('rejects an mfa token when asked to verify it as enrol', () => {
      const token = service.signMfa({ sub: 'user-1', tenantId: 'tenant-1', cid: 'challenge-1' });
      expect(() => service.verify(token, 'enrol')).toThrow(UnauthorizedException);
    });
  });

  describe('enrol tokens', () => {
    it('signs and verifies an enrol step token', () => {
      const token = service.signEnrol({ sub: 'user-1', tenantId: 'tenant-1', tokenVersion: 2 });
      const payload = service.verify(token, 'enrol');

      expect(payload).toMatchObject({
        typ: 'enrol',
        sub: 'user-1',
        tenantId: 'tenant-1',
        tokenVersion: 2,
      });
    });

    it('expires after 15 minutes', () => {
      const token = service.signEnrol({ sub: 'user-1', tenantId: 'tenant-1', tokenVersion: 2 });
      const decoded = jwtService.decode(token) as { exp: number; iat: number };
      expect(decoded.exp - decoded.iat).toBe(15 * 60);
    });
  });

  describe('verify failures', () => {
    it('rejects a bad signature', () => {
      expect(() => service.verify('not-a-jwt', 'mfa')).toThrow(UnauthorizedException);
    });

    it('rejects an expired token', () => {
      const expired = jwtService.sign(
        { typ: 'mfa', sub: 'user-1', tenantId: 'tenant-1', cid: 'c1' },
        { expiresIn: '-1s' },
      );
      expect(() => service.verify(expired, 'mfa')).toThrow(UnauthorizedException);
    });

    it('rejects a normal session token (no typ claim)', () => {
      const sessionToken = jwtService.sign({
        sub: 'user-1',
        email: 'jane@acme.test',
        tenantId: 'tenant-1',
        role: 'EMPLOYEE',
      });
      expect(() => service.verify(sessionToken, 'mfa')).toThrow(UnauthorizedException);
      expect(() => service.verify(sessionToken, 'enrol')).toThrow(UnauthorizedException);
    });
  });
});
