import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { PublicOffersController } from './public-offers.controller';
import { OffersService } from './offers.service';

describe('PublicOffersController', () => {
  let controller: PublicOffersController;
  const service = {
    getPublic: jest.fn().mockResolvedValue({ status: 'SENT' }),
    acceptPublic: jest.fn().mockResolvedValue({ status: 'ACCEPTED' }),
    declinePublic: jest.fn().mockResolvedValue({ status: 'DECLINED' }),
  };
  const token = 'b'.repeat(64);

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicOffersController],
      providers: [{ provide: OffersService, useValue: service }],
    })
      // The real guard needs ThrottlerModule (global in AppModule).
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(PublicOffersController);
  });

  it('is throttled and carries no auth / role guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PublicOffersController);
    expect(guards).toEqual([ThrottlerGuard]);
    expect(new Reflector().get(ROLES_KEY, PublicOffersController)).toBeUndefined();
  });

  it('throttles reads at 20/min and answers at 5/min', () => {
    const limitOf = (name: 'get' | 'accept' | 'decline') =>
      Reflect.getMetadata('THROTTLER:LIMITdefault', PublicOffersController.prototype[name]);
    expect(limitOf('get')).toBe(20);
    expect(limitOf('accept')).toBe(5);
    expect(limitOf('decline')).toBe(5);
  });

  it('passes the token and the request evidence through', async () => {
    const req = { ip: '203.0.113.9', headers: { 'user-agent': 'Mozilla/5.0' } };

    await controller.get(token);
    expect(service.getPublic).toHaveBeenCalledWith(token);

    await controller.accept(token, { acceptedName: 'Asha Rao' }, req as any);
    expect(service.acceptPublic).toHaveBeenCalledWith(
      token,
      { acceptedName: 'Asha Rao' },
      { ip: '203.0.113.9', userAgent: 'Mozilla/5.0' },
    );

    await controller.decline(token, { reason: 'no' }, { headers: {} } as any);
    expect(service.declinePublic).toHaveBeenCalledWith(token, { reason: 'no' }, { ip: null, userAgent: null });
  });
});
