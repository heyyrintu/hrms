import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { FeedbackType, FeedbackVisibility, UserRole } from '@prisma/client';

const mockService = {
  create: jest.fn(),
  findReceived: jest.fn(),
  findSent: jest.fn(),
  findTeam: jest.fn(),
  findById: jest.fn(),
  delete: jest.fn(),
};

describe('FeedbackController', () => {
  let controller: FeedbackController;
  let service: typeof mockService;

  const employeeUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  const managerUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'manager@test.com',
    tenantId: 'tenant-1',
    role: UserRole.MANAGER,
    employeeId: 'emp-mgr-1',
  };

  const userWithoutEmployee: AuthenticatedUser = {
    userId: 'user-3',
    email: 'orphan@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: undefined as unknown as string,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeedbackController],
      providers: [{ provide: FeedbackService, useValue: mockService }],
    }).compile();
    controller = module.get<FeedbackController>(FeedbackController);
    service = module.get(FeedbackService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // create
  // ============================================
  describe('create', () => {
    const dto = {
      receiverId: 'emp-2',
      content: 'Unblocked the release',
      type: FeedbackType.POSITIVE,
      visibility: FeedbackVisibility.PUBLIC,
    };

    it('should pass the caller through as the sender', async () => {
      const expected = { id: 'fb-1' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(employeeUser, dto);

      expect(service.create).toHaveBeenCalledWith('tenant-1', 'emp-1', dto);
      expect(result).toEqual(expected);
    });

    it('should reject a user with no employee profile', async () => {
      await expect(
        controller.create(userWithoutEmployee, dto),
      ).rejects.toThrow(BadRequestException);

      expect(service.create).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // findReceived
  // ============================================
  describe('findReceived', () => {
    it('should return feedback for the caller', async () => {
      const expected = { data: [], meta: {} };
      service.findReceived.mockResolvedValue(expected);

      const result = await controller.findReceived(employeeUser, { page: 1 });

      expect(service.findReceived).toHaveBeenCalledWith(
        'tenant-1',
        'emp-1',
        { page: 1 },
      );
      expect(result).toEqual(expected);
    });

    it('should reject a user with no employee profile', async () => {
      await expect(
        controller.findReceived(userWithoutEmployee, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // findSent
  // ============================================
  describe('findSent', () => {
    it('should return feedback the caller wrote', async () => {
      service.findSent.mockResolvedValue({ data: [], meta: {} });

      await controller.findSent(employeeUser, {});

      expect(service.findSent).toHaveBeenCalledWith('tenant-1', 'emp-1', {});
    });

    it('should reject a user with no employee profile', async () => {
      await expect(
        controller.findSent(userWithoutEmployee, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // findTeam
  // ============================================
  describe('findTeam', () => {
    it('should pass the role through so the service can scope the view', async () => {
      service.findTeam.mockResolvedValue({ data: [], meta: {} });

      await controller.findTeam(managerUser, { limit: 25 });

      expect(service.findTeam).toHaveBeenCalledWith(
        'tenant-1',
        'emp-mgr-1',
        UserRole.MANAGER,
        { limit: 25 },
      );
    });
  });

  // ============================================
  // findById
  // ============================================
  describe('findById', () => {
    it('should pass the caller identity for the visibility check', async () => {
      const expected = { id: 'fb-1' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById(employeeUser, 'fb-1');

      expect(service.findById).toHaveBeenCalledWith(
        'tenant-1',
        'fb-1',
        'emp-1',
        UserRole.EMPLOYEE,
      );
      expect(result).toEqual(expected);
    });
  });

  // ============================================
  // delete
  // ============================================
  describe('delete', () => {
    it('should pass the caller identity for the ownership check', async () => {
      service.delete.mockResolvedValue({ message: 'Feedback deleted' });

      const result = await controller.delete(employeeUser, 'fb-1');

      expect(service.delete).toHaveBeenCalledWith(
        'tenant-1',
        'fb-1',
        'emp-1',
        UserRole.EMPLOYEE,
      );
      expect(result).toEqual({ message: 'Feedback deleted' });
    });
  });
});
