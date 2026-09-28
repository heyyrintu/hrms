import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { SsoProvider } from '@prisma/client';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

const mockService = {
  providers: jest.fn(),
  start: jest.fn(),
  callback: jest.fn(),
  exchange: jest.fn(),
};

function mockResponse() {
  return { redirect: jest.fn() } as any;
}

describe('SsoController', () => {
  let controller: SsoController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SsoController],
      providers: [{ provide: SsoService, useValue: mockService }],
    })
      // The throttler needs its module wiring; unit tests only assert the metadata.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(SsoController);
  });

  it('GET /auth/sso/providers delegates to the service', async () => {
    mockService.providers.mockResolvedValue({ providers: [], requireSso: false });
    const result = await controller.providers('acme');
    expect(mockService.providers).toHaveBeenCalledWith('acme');
    expect(result).toEqual({ providers: [], requireSso: false });
  });

  it('GET /auth/sso/:provider/start redirects to whatever the service returns', async () => {
    mockService.start.mockResolvedValue('https://accounts.google.com/authorize');
    const res = mockResponse();

    await controller.start(SsoProvider.GOOGLE, 'acme', res);

    expect(mockService.start).toHaveBeenCalledWith(SsoProvider.GOOGLE, 'acme');
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://accounts.google.com/authorize');
  });

  it('GET /auth/sso/:provider/callback redirects to whatever the service returns', async () => {
    mockService.callback.mockResolvedValue('http://localhost:3000/sso/callback#code=abc');
    const res = mockResponse();
    const query = { code: 'auth-code', state: 'state-1' };

    await controller.callback(SsoProvider.MICROSOFT, query, res);

    expect(mockService.callback).toHaveBeenCalledWith(SsoProvider.MICROSOFT, query);
    expect(res.redirect).toHaveBeenCalledWith(302, 'http://localhost:3000/sso/callback#code=abc');
  });

  it('POST /auth/sso/exchange delegates to the service', async () => {
    mockService.exchange.mockResolvedValue({ accessToken: 'jwt', user: {} });
    const result = await controller.exchange({ code: 'code-1' } as any);
    expect(mockService.exchange).toHaveBeenCalledWith('code-1');
    expect(result).toEqual({ accessToken: 'jwt', user: {} });
  });
});
