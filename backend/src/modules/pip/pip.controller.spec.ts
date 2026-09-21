import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PipController } from './pip.controller';
import { PipService } from './pip.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { mockEmployee, mockManager, mockHrAdmin } from '../../test/helpers';
import { PIPStatus, UserRole } from '@prisma/client';

const mockService = {
  create: jest.fn(),
  findAll: jest.fn(),
  findMine: jest.fn(),
  findTeam: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  addGoal: jest.fn(),
  updateGoal: jest.fn(),
  deleteGoal: jest.fn(),
};

describe('PipController', () => {
  let controller: PipController;
  let service: typeof mockService;

  const managerNoEmployee: AuthenticatedUser = {
    userId: 'user-no-emp',
    email: 'manager2@test.com',
    tenantId: 'test-tenant',
    role: UserRole.MANAGER,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PipController],
      providers: [{ provide: PipService, useValue: mockService }],
    }).compile();
    controller = module.get<PipController>(PipController);
    service = module.get(PipService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    const dto = {
      employeeId: 'emp-employee',
      title: 'Improve delivery consistency',
      description: 'Three months of focused work',
      startDate: '2025-03-01T12:00:00Z',
      endDate: '2025-06-01T12:00:00Z',
    };

    it('passes the caller as the manager along with their role', async () => {
      mockService.create.mockResolvedValue({ id: 'pip-1' });

      const result = await controller.create(mockManager, dto);

      expect(service.create).toHaveBeenCalledWith(
        mockManager.tenantId,
        mockManager.employeeId,
        UserRole.MANAGER,
        dto,
      );
      expect(result).toEqual({ id: 'pip-1' });
    });

    it('rejects a caller with no employee profile', async () => {
      await expect(controller.create(managerNoEmployee, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('forwards the tenant and query to the service', async () => {
      mockService.findAll.mockResolvedValue({ data: [], meta: {} });
      const query = { page: 1, limit: 20, status: PIPStatus.ACTIVE };

      await controller.findAll(mockHrAdmin, query);

      expect(service.findAll).toHaveBeenCalledWith(mockHrAdmin.tenantId, query);
    });
  });

  describe('findMine', () => {
    it('scopes to the caller employee', async () => {
      mockService.findMine.mockResolvedValue({ data: [], meta: {} });

      await controller.findMine(mockEmployee, {});

      expect(service.findMine).toHaveBeenCalledWith(
        mockEmployee.tenantId,
        mockEmployee.employeeId,
        {},
      );
    });

    it('rejects a caller with no employee profile', async () => {
      await expect(controller.findMine(managerNoEmployee, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findTeam', () => {
    it('scopes to the caller as the manager', async () => {
      mockService.findTeam.mockResolvedValue({ data: [], meta: {} });

      await controller.findTeam(mockManager, { page: 2 });

      expect(service.findTeam).toHaveBeenCalledWith(
        mockManager.tenantId,
        mockManager.employeeId,
        { page: 2 },
      );
    });

    it('rejects a caller with no employee profile', async () => {
      await expect(controller.findTeam(managerNoEmployee, {})).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findById', () => {
    it('hands the whole user to the service for the access check', async () => {
      mockService.findById.mockResolvedValue({ id: 'pip-1' });

      await controller.findById(mockEmployee, 'pip-1');

      expect(service.findById).toHaveBeenCalledWith(
        mockEmployee.tenantId,
        'pip-1',
        mockEmployee,
      );
    });
  });

  describe('update', () => {
    it('forwards the body and the caller', async () => {
      mockService.update.mockResolvedValue({ id: 'pip-1' });
      const dto = { status: PIPStatus.COMPLETED };

      await controller.update(mockManager, 'pip-1', dto);

      expect(service.update).toHaveBeenCalledWith(
        mockManager.tenantId,
        'pip-1',
        mockManager,
        dto,
      );
    });
  });

  describe('goals', () => {
    it('adds a goal', async () => {
      mockService.addGoal.mockResolvedValue({ id: 'goal-1' });
      const dto = {
        description: 'Pair twice a week',
        targetDate: '2025-04-15T12:00:00Z',
      };

      await controller.addGoal(mockManager, 'pip-1', dto);

      expect(service.addGoal).toHaveBeenCalledWith(
        mockManager.tenantId,
        'pip-1',
        mockManager,
        dto,
      );
    });

    it('updates a goal', async () => {
      mockService.updateGoal.mockResolvedValue({ id: 'goal-1' });
      const dto = { isCompleted: true, notes: 'Done' };

      await controller.updateGoal(mockEmployee, 'pip-1', 'goal-1', dto);

      expect(service.updateGoal).toHaveBeenCalledWith(
        mockEmployee.tenantId,
        'pip-1',
        'goal-1',
        mockEmployee,
        dto,
      );
    });

    it('deletes a goal', async () => {
      mockService.deleteGoal.mockResolvedValue({ message: 'Goal deleted' });

      await controller.deleteGoal(mockHrAdmin, 'pip-1', 'goal-1');

      expect(service.deleteGoal).toHaveBeenCalledWith(
        mockHrAdmin.tenantId,
        'pip-1',
        'goal-1',
        mockHrAdmin,
      );
    });
  });
});
