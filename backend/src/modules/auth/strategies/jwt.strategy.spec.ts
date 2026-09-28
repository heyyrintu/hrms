import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from '../auth.service';

describe('JwtStrategy', () => {
  const authService = { validateUser: jest.fn() } as unknown as jest.Mocked<AuthService>;
  const config = { get: jest.fn().mockReturnValue('test-secret') } as unknown as ConfigService;
  const strategy = new JwtStrategy(config, authService);

  const session = {
    sub: 'user-1',
    email: 'u@test.com',
    tenantId: 't1',
    role: 'EMPLOYEE' as any,
    tokenVersion: 2,
  };

  beforeEach(() => jest.clearAllMocks());

  it('delegates a session token (no typ) to validateUser', async () => {
    authService.validateUser.mockResolvedValue({ userId: 'user-1' } as any);

    await expect(strategy.validate(session)).resolves.toEqual({ userId: 'user-1' });
    expect(authService.validateUser).toHaveBeenCalledWith(session);
  });

  it('still accepts tokens issued before tokenVersion existed', async () => {
    authService.validateUser.mockResolvedValue({ userId: 'user-1' } as any);
    const { tokenVersion, ...legacy } = session;

    await expect(strategy.validate(legacy)).resolves.toEqual({ userId: 'user-1' });
  });

  it.each(['mfa', 'enrol', 'anything'])('refuses a step token with typ=%s as a session', async (typ) => {
    await expect(strategy.validate({ ...session, typ } as any)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(authService.validateUser).not.toHaveBeenCalled();
  });

  it('maps a validateUser failure to 401', async () => {
    authService.validateUser.mockRejectedValue(new Error('boom'));

    await expect(strategy.validate(session)).rejects.toThrow(UnauthorizedException);
  });
});
