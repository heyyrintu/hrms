import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getCycles: jest.fn(),
  getCycle: jest.fn(),
  createCycle: jest.fn(),
  updateCycle: jest.fn(),
  deleteCycle: jest.fn(),
  launchCycle: jest.fn(),
  completeCycle: jest.fn(),
  getMyReviews: jest.fn(),
  getReview: jest.fn(),
  submitSelfReview: jest.fn(),
  getTeamReviews: jest.fn(),
  submitManagerReview: jest.fn(),
  getMyGoals: jest.fn(),
  createGoal: jest.fn(),
  updateGoal: jest.fn(),
  deleteGoal: jest.fn(),
};

describe('PerformanceController', () => {
  let controller: PerformanceController;
  let service: typeof mockService;

  const adminUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-1',
  };

  const employeeUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-2',
  };

  const managerUser: AuthenticatedUser = {
    userId: 'user-3',
    email: 'manager@test.com',
    tenantId: 'tenant-1',
    role: UserRole.MANAGER,
    employeeId: 'emp-3',
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
      controllers: [PerformanceController],
      providers: [{ provide: PerformanceService, useValue: mockService }],
    }).compile();
    controller = module.get<PerformanceController>(PerformanceController);
    service = module.get(PerformanceService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // Review Cycles (HR_ADMIN / SUPER_ADMIN)
  // ============================================
  describe('getCycles', () => {
    it('should return review cycles with query params', async () => {
      const expected = { data: [{ id: 'cycle-1' }], total: 1 };
      const query = { status: 'ACTIVE', page: '1', limit: '20' };
      service.getCycles.mockResolvedValue(expected);

      const result = await controller.getCycles(adminUser, query);

      expect(result).toEqual(expected);
      expect(service.getCycles).toHaveBeenCalledWith(
        adminUser.tenantId,
        query,
      );
    });
  });

  describe('getCycle', () => {
    it('should return a single review cycle', async () => {
      const expected = { id: 'cycle-1', name: 'Q1 2025 Review' };
      service.getCycle.mockResolvedValue(expected);

      const result = await controller.getCycle(adminUser, 'cycle-1');

      expect(result).toEqual(expected);
      expect(service.getCycle).toHaveBeenCalledWith(
        adminUser.tenantId,
        'cycle-1',
      );
    });
  });

  describe('createCycle', () => {
    const dto = {
      name: 'Q1 2025 Review',
      startDate: '2025-01-01',
      endDate: '2025-03-31',
    };

    it('should create a review cycle', async () => {
      const expected = { id: 'cycle-1', ...dto };
      service.createCycle.mockResolvedValue(expected);

      const result = await controller.createCycle(adminUser, dto);

      expect(result).toEqual(expected);
      expect(service.createCycle).toHaveBeenCalledWith(
        adminUser.tenantId,
        dto,
      );
    });
  });

  describe('updateCycle', () => {
    const dto = { name: 'Updated Q1 Review' };

    it('should update a review cycle', async () => {
      const expected = { id: 'cycle-1', name: 'Updated Q1 Review' };
      service.updateCycle.mockResolvedValue(expected);

      const result = await controller.updateCycle(adminUser, 'cycle-1', dto);

      expect(result).toEqual(expected);
      expect(service.updateCycle).toHaveBeenCalledWith(
        adminUser.tenantId,
        'cycle-1',
        dto,
      );
    });
  });

  describe('deleteCycle', () => {
    it('should delete a review cycle', async () => {
      const expected = { id: 'cycle-1', deleted: true };
      service.deleteCycle.mockResolvedValue(expected);

      const result = await controller.deleteCycle(adminUser, 'cycle-1');

      expect(result).toEqual(expected);
      expect(service.deleteCycle).toHaveBeenCalledWith(
        adminUser.tenantId,
        'cycle-1',
      );
    });
  });

  describe('launchCycle', () => {
    it('should launch a review cycle', async () => {
      const expected = { id: 'cycle-1', status: 'ACTIVE' };
      service.launchCycle.mockResolvedValue(expected);

      const result = await controller.launchCycle(adminUser, 'cycle-1');

      expect(result).toEqual(expected);
      expect(service.launchCycle).toHaveBeenCalledWith(
        adminUser.tenantId,
        'cycle-1',
      );
    });
  });

  describe('completeCycle', () => {
    it('should complete a review cycle', async () => {
      const expected = { id: 'cycle-1', status: 'COMPLETED' };
      service.completeCycle.mockResolvedValue(expected);

      const result = await controller.completeCycle(adminUser, 'cycle-1');

      expect(result).toEqual(expected);
      expect(service.completeCycle).toHaveBeenCalledWith(
        adminUser.tenantId,
        'cycle-1',
      );
    });
  });

  // ============================================
  // My Reviews (All authenticated users)
  // ============================================
  describe('getMyReviews', () => {
    it('should return reviews for the employee', async () => {
      const expected = { data: [{ id: 'rev-1' }], total: 1 };
      const query = { status: 'PENDING', page: '1', limit: '20' };
      service.getMyReviews.mockResolvedValue(expected);

      const result = await controller.getMyReviews(employeeUser, query);

      expect(result).toEqual(expected);
      expect(service.getMyReviews).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        query,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.getMyReviews(userNoEmployee, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getReview', () => {
    it('should return a single review with role-based access', async () => {
      const expected = { id: 'rev-1', status: 'PENDING' };
      service.getReview.mockResolvedValue(expected);

      const result = await controller.getReview(employeeUser, 'rev-1');

      expect(result).toEqual(expected);
      expect(service.getReview).toHaveBeenCalledWith(
        employeeUser.tenantId,
        'rev-1',
        employeeUser.employeeId,
        employeeUser.role,
      );
    });

    it('should pass manager role and employeeId', async () => {
      service.getReview.mockResolvedValue({ id: 'rev-1' });

      await controller.getReview(managerUser, 'rev-1');

      expect(service.getReview).toHaveBeenCalledWith(
        managerUser.tenantId,
        'rev-1',
        managerUser.employeeId,
        managerUser.role,
      );
    });
  });

  describe('submitSelfReview', () => {
    const dto = { selfRating: 4, selfComments: 'Good performance' };

    it('should submit a self-review', async () => {
      const expected = { id: 'rev-1', selfRating: 4 };
      service.submitSelfReview.mockResolvedValue(expected);

      const result = await controller.submitSelfReview(
        employeeUser,
        'rev-1',
        dto,
      );

      expect(result).toEqual(expected);
      expect(service.submitSelfReview).toHaveBeenCalledWith(
        employeeUser.tenantId,
        'rev-1',
        employeeUser.employeeId,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.submitSelfReview(userNoEmployee, 'rev-1', dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // Team Reviews (Manager / HR / Super Admin)
  // ============================================
  describe('getTeamReviews', () => {
    it('should return team reviews for a manager', async () => {
      const expected = { data: [{ id: 'rev-1' }], total: 1 };
      const query = { status: 'MANAGER_REVIEW' };
      service.getTeamReviews.mockResolvedValue(expected);

      const result = await controller.getTeamReviews(managerUser, query);

      expect(result).toEqual(expected);
      expect(service.getTeamReviews).toHaveBeenCalledWith(
        managerUser.tenantId,
        managerUser.employeeId,
        managerUser.role,
        query,
      );
    });

    it('should return team reviews for admin', async () => {
      service.getTeamReviews.mockResolvedValue({ data: [], total: 0 });

      await controller.getTeamReviews(adminUser, {});

      expect(service.getTeamReviews).toHaveBeenCalledWith(
        adminUser.tenantId,
        adminUser.employeeId,
        adminUser.role,
        {},
      );
    });
  });

  describe('submitManagerReview', () => {
    const dto = {
      managerRating: 4,
      managerComments: 'Strong performer',
      overallRating: 4,
    };

    it('should submit a manager review', async () => {
      const expected = { id: 'rev-1', managerRating: 4 };
      service.submitManagerReview.mockResolvedValue(expected);

      const result = await controller.submitManagerReview(
        managerUser,
        'rev-1',
        dto,
      );

      expect(result).toEqual(expected);
      expect(service.submitManagerReview).toHaveBeenCalledWith(
        managerUser.tenantId,
        'rev-1',
        managerUser.employeeId,
        managerUser.role,
        dto,
      );
    });
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
