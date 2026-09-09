import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { mockHrAdmin } from '../../../test/helpers';

const mockSettlementService = {
  compute: jest.fn(),
  findOne: jest.fn(),
  findBySeparation: jest.fn(),
  update: jest.fn(),
  approve: jest.fn(),
  markPaid: jest.fn(),
};

describe('SettlementController', () => {
  let controller: SettlementController;
  let service: typeof mockSettlementService;

  beforeEach(async () => {
    Object.values(mockSettlementService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettlementController],
      providers: [
        { provide: SettlementService, useValue: mockSettlementService },
      ],
    }).compile();

    controller = module.get<SettlementController>(SettlementController);
    service = module.get(SettlementService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('takes the tenant from the token, never from the request body', async () => {
    service.compute.mockResolvedValue({ id: 'stl-1' });

    await controller.compute(mockHrAdmin, 'sep-1', {});

    expect(service.compute).toHaveBeenCalledWith(
      mockHrAdmin.tenantId,
      'sep-1',
      {},
    );
  });

  it('reads a settlement by id', async () => {
    service.findOne.mockResolvedValue({ id: 'stl-1' });

    await controller.findOne(mockHrAdmin, 'stl-1');

    expect(service.findOne).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'stl-1');
  });

  it('reads a settlement by separation', async () => {
    service.findBySeparation.mockResolvedValue({ id: 'stl-1' });

    await controller.findBySeparation(mockHrAdmin, 'sep-1');

    expect(service.findBySeparation).toHaveBeenCalledWith(
      mockHrAdmin.tenantId,
      'sep-1',
    );
  });

  it('passes the manual figures through', async () => {
    service.update.mockResolvedValue({ id: 'stl-1' });

    await controller.update(mockHrAdmin, 'stl-1', { tds: 1000 });

    expect(service.update).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'stl-1', {
      tds: 1000,
    });
  });

  it('records the approver from the token', async () => {
    service.approve.mockResolvedValue({ id: 'stl-1' });

    await controller.approve(mockHrAdmin, 'stl-1');

    expect(service.approve).toHaveBeenCalledWith(
      mockHrAdmin.tenantId,
      'stl-1',
      mockHrAdmin.userId,
    );
  });

  it('marks a settlement paid', async () => {
    service.markPaid.mockResolvedValue({ id: 'stl-1' });

    await controller.markPaid(mockHrAdmin, 'stl-1');

    expect(service.markPaid).toHaveBeenCalledWith(mockHrAdmin.tenantId, 'stl-1');
  });

  it('restricts every endpoint to HR administrators', () => {
    const reflector = new Reflector();
    const handlers = [
      controller.compute,
      controller.findBySeparation,
      controller.findOne,
      controller.update,
      controller.approve,
      controller.markPaid,
    ];

    for (const handler of handlers) {
      expect(reflector.get(ROLES_KEY, handler)).toEqual([
        UserRole.SUPER_ADMIN,
        UserRole.HR_ADMIN,
      ]);
    }
  });
});
