import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

const mockService = {
  getMyGoals: jest.fn(),
  list: jest.fn(),
  tree: jest.fn(),
  getGoal: jest.fn(),
  createGoal: jest.fn(),
  updateGoal: jest.fn(),
  deleteGoal: jest.fn(),
  addKeyResult: jest.fn(),
  updateKeyResult: jest.fn(),
  removeKeyResult: jest.fn(),
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

  describe('getMyGoals', () => {
    it('should return goals for the employee', async () => {
      const expected = [{ id: 'goal-1', title: 'Improve skills' }];
      service.getMyGoals.mockResolvedValue(expected);

      const result = await controller.getMyGoals(employeeUser);

      expect(result).toEqual(expected);
      expect(service.getMyGoals).toHaveBeenCalledWith(employeeUser);
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(controller.getMyGoals(userNoEmployee)).rejects.toThrow(BadRequestException);
      expect(service.getMyGoals).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('passes the scope query through', async () => {
      service.list.mockResolvedValue([]);
      await controller.list(employeeUser, { scope: 'company' });
      expect(service.list).toHaveBeenCalledWith(employeeUser, { scope: 'company' });
    });

    // Review Focus 5
    it('400s the mine scope without an employeeId before calling the service', async () => {
      await expect(controller.list(userNoEmployee, { scope: 'mine' })).rejects.toThrow(BadRequestException);
      expect(service.list).not.toHaveBeenCalled();
    });

    it('leaves team scope to the service (admins have no employee record)', async () => {
      service.list.mockResolvedValue([]);
      await controller.list(userNoEmployee, { scope: 'team' });
      expect(service.list).toHaveBeenCalledWith(userNoEmployee, { scope: 'team' });
    });
  });

  describe('tree / getGoal', () => {
    it('passes rootId to the tree', async () => {
      service.tree.mockResolvedValue([]);
      await controller.tree(employeeUser, { rootId: 'g1' });
      expect(service.tree).toHaveBeenCalledWith(employeeUser, 'g1');
    });

    it('gets one goal', async () => {
      service.getGoal.mockResolvedValue({ id: 'g1' });
      expect(await controller.getGoal(employeeUser, 'g1')).toEqual({ id: 'g1' });
      expect(service.getGoal).toHaveBeenCalledWith(employeeUser, 'g1');
    });

    it('declares goals/tree before goals/:id so "tree" is not read as an id', () => {
      const names = Object.getOwnPropertyNames(GoalsController.prototype);
      expect(names.indexOf('tree')).toBeLessThan(names.indexOf('getGoal'));
    });
  });

  describe('createGoal / updateGoal / deleteGoal', () => {
    const dto = { reviewId: 'rev-1', title: 'Learn TypeScript', targetDate: '2025-06-30' };

    it('creates through the service with the caller', async () => {
      service.createGoal.mockResolvedValue({ id: 'goal-1', ...dto });
      const result = await controller.createGoal(employeeUser, dto);
      expect(result).toEqual({ id: 'goal-1', ...dto });
      expect(service.createGoal).toHaveBeenCalledWith(employeeUser, dto);
    });

    it('lets a caller without an employee profile reach the service (admins create company goals)', async () => {
      service.createGoal.mockResolvedValue({ id: 'co1' });
      await controller.createGoal(userNoEmployee, dto);
      expect(service.createGoal).toHaveBeenCalledWith(userNoEmployee, dto);
    });

    it('updates', async () => {
      service.updateGoal.mockResolvedValue({ id: 'goal-1', progress: 50 });
      const result = await controller.updateGoal(employeeUser, 'goal-1', { progress: 50 });
      expect(result).toEqual({ id: 'goal-1', progress: 50 });
      expect(service.updateGoal).toHaveBeenCalledWith(employeeUser, 'goal-1', { progress: 50 });
    });

    it('deletes', async () => {
      service.deleteGoal.mockResolvedValue({ message: 'Goal deleted' });
      const result = await controller.deleteGoal(employeeUser, 'goal-1');
      expect(result).toEqual({ message: 'Goal deleted' });
      expect(service.deleteGoal).toHaveBeenCalledWith(employeeUser, 'goal-1');
    });
  });

  describe('key results', () => {
    it('adds, updates and removes through the service', async () => {
      service.addKeyResult.mockResolvedValue({ id: 'kr1' });
      service.updateKeyResult.mockResolvedValue({ id: 'kr1' });
      service.removeKeyResult.mockResolvedValue({ message: 'Key result deleted' });

      await controller.addKeyResult(employeeUser, 'g1', { title: 'KR', targetValue: 10 });
      expect(service.addKeyResult).toHaveBeenCalledWith(employeeUser, 'g1', { title: 'KR', targetValue: 10 });

      await controller.updateKeyResult(employeeUser, 'g1', 'kr1', { currentValue: 5 });
      expect(service.updateKeyResult).toHaveBeenCalledWith(employeeUser, 'g1', 'kr1', { currentValue: 5 });

      await controller.removeKeyResult(employeeUser, 'g1', 'kr1');
      expect(service.removeKeyResult).toHaveBeenCalledWith(employeeUser, 'g1', 'kr1');
    });
  });

  describe('roles', () => {
    it('every route declares @Roles for all four roles', () => {
      const reflector = new Reflector();
      const routes = [
        'getMyGoals', 'list', 'tree', 'getGoal', 'createGoal', 'updateGoal', 'deleteGoal',
        'addKeyResult', 'updateKeyResult', 'removeKeyResult',
      ] as const;
      for (const route of routes) {
        const roles = reflector.get<UserRole[]>(ROLES_KEY, GoalsController.prototype[route]);
        expect([...roles].sort()).toEqual(
          [UserRole.EMPLOYEE, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.SUPER_ADMIN].sort(),
        );
      }
    });
  });
});
