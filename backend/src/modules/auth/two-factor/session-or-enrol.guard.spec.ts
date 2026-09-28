import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SessionOrEnrolGuard } from './session-or-enrol.guard';
import { StepTokenService } from './step-token.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

function contextWithAuthHeader(authorization?: string): ExecutionContext {
  const request: any = { headers: authorization ? { authorization } : {}, user: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** A JWT-shaped string with the given payload, unsigned — enough for the guard to decode `typ`. */
function fakeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

describe('SessionOrEnrolGuard', () => {
  let guard: SessionOrEnrolGuard;
  let jwtAuthGuard: { canActivate: jest.Mock };
  let stepTokenService: { verify: jest.Mock };
  let prisma: any;

  beforeEach(() => {
    jwtAuthGuard = { canActivate: jest.fn() };
    stepTokenService = { verify: jest.fn() };
    prisma = createMockPrismaService();

    guard = new SessionOrEnrolGuard(
      jwtAuthGuard as unknown as JwtAuthGuard,
      stepTokenService as unknown as StepTokenService,
      prisma as unknown as PrismaService,
    );
  });

  it('delegates to the JWT strategy when the token has no typ claim', async () => {
    jwtAuthGuard.canActivate.mockResolvedValue(true);
    const context = contextWithAuthHeader(`Bearer ${fakeToken({ sub: 'user-1' })}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(context);
    expect(stepTokenService.verify).not.toHaveBeenCalled();
  });

  it('delegates to the JWT strategy when there is no Authorization header at all', async () => {
    jwtAuthGuard.canActivate.mockResolvedValue(false);
    const context = contextWithAuthHeader(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(jwtAuthGuard.canActivate).toHaveBeenCalledWith(context);
  });

  it('rejects a typ that is neither absent nor enrol', async () => {
    const context = contextWithAuthHeader(`Bearer ${fakeToken({ typ: 'mfa' })}`);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(jwtAuthGuard.canActivate).not.toHaveBeenCalled();
    expect(stepTokenService.verify).not.toHaveBeenCalled();
  });

  describe('typ: enrol', () => {
    const token = `Bearer ${fakeToken({ typ: 'enrol', sub: 'user-1', tenantId: 'tenant-1', tokenVersion: 2 })}`;

    it('sets an enrol-only request.user when the token and user state check out', async () => {
      stepTokenService.verify.mockReturnValue({
        typ: 'enrol',
        sub: 'user-1',
        tenantId: 'tenant-1',
        tokenVersion: 2,
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'jane@acme.test',
        tenantId: 'tenant-1',
        role: 'EMPLOYEE',
        employeeId: 'emp-1',
        isActive: true,
        tokenVersion: 2,
        totpEnabledAt: null,
      });
      const context = contextWithAuthHeader(token);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(stepTokenService.verify).toHaveBeenCalledWith(expect.any(String), 'enrol');

      const request = context.switchToHttp().getRequest();
      expect(request.user).toEqual({
        userId: 'user-1',
        email: 'jane@acme.test',
        tenantId: 'tenant-1',
        role: 'EMPLOYEE',
        employeeId: 'emp-1',
        permissions: [],
        enrolOnly: true,
      });
    });

    it('rejects when the user is inactive', async () => {
      stepTokenService.verify.mockReturnValue({
        typ: 'enrol',
        sub: 'user-1',
        tenantId: 'tenant-1',
        tokenVersion: 2,
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isActive: false,
        tokenVersion: 2,
        totpEnabledAt: null,
      });

      await expect(guard.canActivate(contextWithAuthHeader(token))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when the user no longer exists', async () => {
      stepTokenService.verify.mockReturnValue({
        typ: 'enrol',
        sub: 'user-1',
        tenantId: 'tenant-1',
        tokenVersion: 2,
      });
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(guard.canActivate(contextWithAuthHeader(token))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a stale tokenVersion', async () => {
      stepTokenService.verify.mockReturnValue({
        typ: 'enrol',
        sub: 'user-1',
        tenantId: 'tenant-1',
        tokenVersion: 2,
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isActive: true,
        tokenVersion: 3, // password changed since the token was issued
        totpEnabledAt: null,
      });

      await expect(guard.canActivate(contextWithAuthHeader(token))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when 2FA is already enabled', async () => {
      stepTokenService.verify.mockReturnValue({
        typ: 'enrol',
        sub: 'user-1',
        tenantId: 'tenant-1',
        tokenVersion: 2,
      });
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        isActive: true,
        tokenVersion: 2,
        totpEnabledAt: new Date('2026-01-01T00:00:00Z'),
      });

      await expect(guard.canActivate(contextWithAuthHeader(token))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('propagates the 401 thrown by StepTokenService.verify (bad signature/expiry)', async () => {
      stepTokenService.verify.mockImplementation(() => {
        throw new UnauthorizedException('Invalid or expired token');
      });

      await expect(guard.canActivate(contextWithAuthHeader(token))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
