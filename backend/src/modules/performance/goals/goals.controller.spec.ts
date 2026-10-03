import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getMyGoals: jest.fn(),
  createGoal: jest.fn(),
  updateGoal: jest.fn(),
  deleteGoal: jest.fn(),
};

describe('GoalsController', () => {
  let controller: GoalsController;
  let service: typeof mockService;

  const employeeUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-2',
  };

  const userNoEmployee: AuthenticatedUser = {
    userId: 'user-4',
    email: 'noemp@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GoalsController],
      providers: [{ provide: GoalsService, useValue: mockService }],
    }).compile();
    controller = module.get<GoalsController>(GoalsController);
    service = module.get(GoalsService);
  });

  // ============================================
  // Goals (All authenticated users - own goals)
  // ============================================
  describe('getMyGoals', () => {
    it('should return goals for the employee', async () => {
      const expected = [{ id: 'goal-1', title: 'Improve skills' }];
      service.getMyGoals.mockResolvedValue(expected);

      const result = await controller.getMyGoals(employeeUser);

      expect(result).toEqual(expected);
      expect(service.getMyGoals).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(controller.getMyGoals(userNoEmployee)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createGoal', () => {
    const dto = {
      reviewId: 'rev-1',
      title: 'Learn TypeScript',
      targetDate: '2025-06-30',
    };

    it('should create a goal', async () => {
      const expected = { id: 'goal-1', ...dto };
      service.createGoal.mockResolvedValue(expected);

      const result = await controller.createGoal(employeeUser, dto);

      expect(result).toEqual(expected);
      expect(service.createGoal).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.createGoal(userNoEmployee, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateGoal', () => {
    const dto = { progress: 50, status: 'IN_PROGRESS' };

    it('should update a goal', async () => {
      const expected = { id: 'goal-1', progress: 50 };
      service.updateGoal.mockResolvedValue(expected);

      const result = await controller.updateGoal(
        employeeUser,
        'goal-1',
        dto,
      );

      expect(result).toEqual(expected);
      expect(service.updateGoal).toHaveBeenCalledWith(
        employeeUser.tenantId,
        'goal-1',
        employeeUser.employeeId,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.updateGoal(userNoEmployee, 'goal-1', dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteGoal', () => {
    it('should delete a goal', async () => {
      const expected = { id: 'goal-1', deleted: true };
      service.deleteGoal.mockResolvedValue(expected);

      const result = await controller.deleteGoal(employeeUser, 'goal-1');

      expect(result).toEqual(expected);
      expect(service.deleteGoal).toHaveBeenCalledWith(
        employeeUser.tenantId,
        'goal-1',
        employeeUser.employeeId,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.deleteGoal(userNoEmployee, 'goal-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
