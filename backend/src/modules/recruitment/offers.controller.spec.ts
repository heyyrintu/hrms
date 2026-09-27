import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { mockHrAdmin } from '../../test/helpers';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';
import { OfferConversionService } from './offer-conversion.service';

describe('OffersController', () => {
  let controller: OffersController;
  const service = {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({ id: 'off-1' }),
    create: jest.fn().mockResolvedValue({ id: 'off-1' }),
    update: jest.fn().mockResolvedValue({ id: 'off-1' }),
    submit: jest.fn().mockResolvedValue({ id: 'off-1' }),
    send: jest.fn().mockResolvedValue({ id: 'off-1' }),
    withdraw: jest.fn().mockResolvedValue({ id: 'off-1' }),
    pdf: jest.fn().mockResolvedValue({ buffer: Buffer.from('%PDF-1'), fileName: 'offer-Asha-Rao.pdf' }),
  };
  const conversion = { convert: jest.fn().mockResolvedValue({ employeeId: 'e1' }) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [OffersController],
      providers: [
        { provide: OffersService, useValue: service },
        { provide: OfferConversionService, useValue: conversion },
      ],
    }).compile();
    controller = moduleRef.get(OffersController);
  });

  it('is HR / SUPER_ADMIN only', () => {
    const roles = new Reflector().get<UserRole[]>(ROLES_KEY, OffersController);
    expect(roles).toEqual([UserRole.SUPER_ADMIN, UserRole.HR_ADMIN]);
  });

  it('delegates each route with the actor', async () => {
    await controller.list(mockHrAdmin, { status: 'SENT' as any });
    expect(service.list).toHaveBeenCalledWith(mockHrAdmin, { status: 'SENT' });

    const dto = { templateId: 't', annualCtc: 1, joiningDate: '2026-04-01' };
    await controller.create(mockHrAdmin, 'app-1', dto);
    expect(service.create).toHaveBeenCalledWith(mockHrAdmin, 'app-1', dto);

    await controller.submit(mockHrAdmin, 'off-1');
    await controller.send(mockHrAdmin, 'off-1');
    await controller.withdraw(mockHrAdmin, 'off-1');
    expect(service.submit).toHaveBeenCalledWith(mockHrAdmin, 'off-1');
    expect(service.send).toHaveBeenCalledWith(mockHrAdmin, 'off-1');
    expect(service.withdraw).toHaveBeenCalledWith(mockHrAdmin, 'off-1');

    await controller.convert(mockHrAdmin, 'off-1', { employeeCode: 'E1' });
    expect(conversion.convert).toHaveBeenCalledWith(mockHrAdmin, 'off-1', { employeeCode: 'E1' });
  });

  it('streams the PDF as an attachment', async () => {
    const res = { set: jest.fn(), end: jest.fn() };
    await controller.pdf(mockHrAdmin, 'off-1', res as any);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="offer-Asha-Rao.pdf"',
      }),
    );
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF-1'));
  });
});
