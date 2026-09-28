import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { TwoFactorController } from './two-factor.controller';
import { TwoFactorService } from './two-factor.service';
import { SessionOrEnrolGuard } from './session-or-enrol.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

const mockService = {
  verify: jest.fn(),
  setup: jest.fn(),
  enable: jest.fn(),
  disable: jest.fn(),
  regenerateRecoveryCodes: jest.fn(),
  status: jest.fn(),
};

const mockUser = { userId: 'user-1', email: 'jane@acme.test', tenantId: 'tenant-1', role: 'EMPLOYEE' } as any;

describe('TwoFactorController', () => {
  let controller: TwoFactorController;

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TwoFactorController],
      providers: [{ provide: TwoFactorService, useValue: mockService }],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SessionOrEnrolGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TwoFactorController>(TwoFactorController);
  });

  it('verify delegates to the service with mfaToken and code', async () => {
    mockService.verify.mockResolvedValue({ accessToken: 'tok', user: {} });

    const result = await controller.verify({ mfaToken: 'mfa-tok', code: '123456' });

    expect(mockService.verify).toHaveBeenCalledWith('mfa-tok', '123456');
    expect(result).toEqual({ accessToken: 'tok', user: {} });
  });

  it('setup delegates to the service with the current user', async () => {
    mockService.setup.mockResolvedValue({ otpauthUrl: 'x', qrCodeDataUrl: 'y' });

    const result = await controller.setup(mockUser);

    expect(mockService.setup).toHaveBeenCalledWith(mockUser);
    expect(result).toEqual({ otpauthUrl: 'x', qrCodeDataUrl: 'y' });
  });

  it('enable delegates to the service with the current user and code', async () => {
    mockService.enable.mockResolvedValue({ recoveryCodes: ['a'], session: {} });

    const result = await controller.enable(mockUser, { code: '123456' });

    expect(mockService.enable).toHaveBeenCalledWith(mockUser, '123456');
    expect(result).toEqual({ recoveryCodes: ['a'], session: {} });
  });

  it('disable delegates to the service with password and code', async () => {
    mockService.disable.mockResolvedValue({ accessToken: 'tok', user: {} });

    const result = await controller.disable(mockUser, { password: 'pw', code: '123456' });

    expect(mockService.disable).toHaveBeenCalledWith(mockUser, 'pw', '123456');
    expect(result).toEqual({ accessToken: 'tok', user: {} });
  });

  it('regenerateRecoveryCodes delegates to the service', async () => {
    mockService.regenerateRecoveryCodes.mockResolvedValue({ recoveryCodes: ['a', 'b'] });

    const result = await controller.regenerateRecoveryCodes(mockUser, { code: '123456' });

    expect(mockService.regenerateRecoveryCodes).toHaveBeenCalledWith(mockUser, '123456');
    expect(result).toEqual({ recoveryCodes: ['a', 'b'] });
  });

  it('status delegates to the service', async () => {
    mockService.status.mockResolvedValue({
      enabled: true,
      enabledAt: null,
      required: false,
      recoveryCodesRemaining: 10,
    });

    const result = await controller.status(mockUser);

    expect(mockService.status).toHaveBeenCalledWith(mockUser);
    expect(result.enabled).toBe(true);
  });
});
