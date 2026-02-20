import { Test, TestingModule } from '@nestjs/testing';
import { ExitController } from './exit.controller';
import { ExitService } from './exit.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockExitService = {
  initiate: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
  moveToNoticePeriod: jest.fn(),
  moveToClearance: jest.fn(),
  complete: jest.fn(),
  cancel: jest.fn(),
};

describe('ExitController', () => {
  let controller: ExitController;
  let service: typeof mockExitService;

  const hrUser: AuthenticatedUser = {
    userId: 'user-hr',
    email: 'hr@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-hr',
  };

  beforeEach(async () => {
    Object.values(mockExitService).forEach((fn) => fn.mockReset());

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExitController],
      providers: [{ provide: ExitService, useValue: mockExitService }],
    }).compile();

    controller = module.get<ExitController>(ExitController);
    service = module.get(ExitService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('initiate', () => {
    it('should call service.initiate with tenantId, userId, dto', async () => {
      const dto = { employeeId: 'emp-1', type: 'RESIGNATION', reason: 'Moving' };
      service.initiate.mockResolvedValue({ id: 'sep-1' });

      const result = await controller.initiate(hrUser, dto as any);

      expect(service.initiate).toHaveBeenCalledWith('tenant-1', 'user-hr', dto);
      expect(result.id).toBe('sep-1');
    });
  });

  describe('findAll', () => {
    it('should call service.findAll with tenantId and query', async () => {
      service.findAll.mockResolvedValue([]);

      await controller.findAll(hrUser, { status: 'INITIATED' });

      expect(service.findAll).toHaveBeenCalledWith('tenant-1', { status: 'INITIATED' });
    });
  });

  describe('findOne', () => {
    it('should call service.findOne with tenantId and id', async () => {
      service.findOne.mockResolvedValue({ id: 'sep-1' });

      const result = await controller.findOne(hrUser, 'sep-1');

      expect(service.findOne).toHaveBeenCalledWith('tenant-1', 'sep-1');
      expect(result.id).toBe('sep-1');
    });
  });

  describe('update', () => {
    it('should call service.update with tenantId, id, dto', async () => {
      const dto = { reason: 'Updated' };
      service.update.mockResolvedValue({ id: 'sep-1', reason: 'Updated' });

      await controller.update(hrUser, 'sep-1', dto as any);

      expect(service.update).toHaveBeenCalledWith('tenant-1', 'sep-1', dto);
    });
  });

  describe('moveToNoticePeriod', () => {
    it('should call service.moveToNoticePeriod', async () => {
      service.moveToNoticePeriod.mockResolvedValue({ id: 'sep-1', status: 'NOTICE_PERIOD' });

      const result = await controller.moveToNoticePeriod(hrUser, 'sep-1');

      expect(service.moveToNoticePeriod).toHaveBeenCalledWith('tenant-1', 'sep-1');
      expect(result.status).toBe('NOTICE_PERIOD');
    });
  });

  describe('moveToClearance', () => {
    it('should call service.moveToClearance', async () => {
      service.moveToClearance.mockResolvedValue({ id: 'sep-1', status: 'CLEARANCE_PENDING' });

      const result = await controller.moveToClearance(hrUser, 'sep-1');

      expect(service.moveToClearance).toHaveBeenCalledWith('tenant-1', 'sep-1');
      expect(result.status).toBe('CLEARANCE_PENDING');
    });
  });

  describe('complete', () => {
    it('should call service.complete', async () => {
      service.complete.mockResolvedValue({ id: 'sep-1', status: 'COMPLETED' });

      const result = await controller.complete(hrUser, 'sep-1');

      expect(service.complete).toHaveBeenCalledWith('tenant-1', 'sep-1');
      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('cancel', () => {
    it('should call service.cancel', async () => {
      service.cancel.mockResolvedValue({ id: 'sep-1', status: 'CANCELLED' });

      const result = await controller.cancel(hrUser, 'sep-1');

      expect(service.cancel).toHaveBeenCalledWith('tenant-1', 'sep-1');
      expect(result.status).toBe('CANCELLED');
    });
  });
});
