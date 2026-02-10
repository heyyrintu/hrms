import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SelfServiceController } from './self-service.controller';
import { SelfServiceService } from './self-service.service';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

const mockService = {
  getMyProfile: jest.fn(),
  createChangeRequest: jest.fn(),
  getMyChangeRequests: jest.fn(),
  getPendingReviews: jest.fn(),
  getAllChangeRequests: jest.fn(),
  reviewChangeRequest: jest.fn(),
};

describe('SelfServiceController', () => {
  let controller: SelfServiceController;
  let service: typeof mockService;

  const employeeUser: AuthenticatedUser = {
    userId: 'user-1',
    email: 'employee@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: 'emp-1',
  };

  const adminUser: AuthenticatedUser = {
    userId: 'user-2',
    email: 'admin@test.com',
    tenantId: 'tenant-1',
    role: UserRole.HR_ADMIN,
    employeeId: 'emp-2',
  };

  const userNoEmployee: AuthenticatedUser = {
    userId: 'user-3',
    email: 'noemp@test.com',
    tenantId: 'tenant-1',
    role: UserRole.EMPLOYEE,
    employeeId: undefined,
  };

  beforeEach(async () => {
    Object.values(mockService).forEach((fn) => fn.mockReset());
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SelfServiceController],
      providers: [{ provide: SelfServiceService, useValue: mockService }],
    }).compile();
    controller = module.get<SelfServiceController>(SelfServiceController);
    service = module.get(SelfServiceService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ============================================
  // getMyProfile
  // ============================================
  describe('getMyProfile', () => {
    it('should return the employee profile', async () => {
      const expected = { id: 'emp-1', name: 'John' };
      service.getMyProfile.mockResolvedValue(expected);

      const result = await controller.getMyProfile(employeeUser);

      expect(result).toEqual(expected);
      expect(service.getMyProfile).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(controller.getMyProfile(userNoEmployee)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // createChangeRequest
  // ============================================
  describe('createChangeRequest', () => {
    const dto = {
      fieldName: 'phone',
      newValue: '+1234567890',
      reason: 'Updated phone number',
    };

    it('should create a change request', async () => {
      const expected = { id: 'cr-1', fieldName: 'phone' };
      service.createChangeRequest.mockResolvedValue(expected);

      const result = await controller.createChangeRequest(employeeUser, dto);

      expect(result).toEqual(expected);
      expect(service.createChangeRequest).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
        dto,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.createChangeRequest(userNoEmployee, dto),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // getMyChangeRequests
  // ============================================
  describe('getMyChangeRequests', () => {
    it('should return change requests for the employee', async () => {
      const expected = [{ id: 'cr-1' }];
      service.getMyChangeRequests.mockResolvedValue(expected);

      const result = await controller.getMyChangeRequests(employeeUser);

      expect(result).toEqual(expected);
      expect(service.getMyChangeRequests).toHaveBeenCalledWith(
        employeeUser.tenantId,
        employeeUser.employeeId,
      );
    });

    it('should throw BadRequestException when no employeeId', async () => {
      await expect(
        controller.getMyChangeRequests(userNoEmployee),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // getPendingReviews
  // ============================================
  describe('getPendingReviews', () => {
    it('should return pending reviews for admin', async () => {
      const expected = [{ id: 'cr-1', status: 'PENDING' }];
      service.getPendingReviews.mockResolvedValue(expected);

      const result = await controller.getPendingReviews(adminUser);

      expect(result).toEqual(expected);
      expect(service.getPendingReviews).toHaveBeenCalledWith(
        adminUser.tenantId,
      );
    });
  });

  // ============================================
  // getAllChangeRequests
  // ============================================
  describe('getAllChangeRequests', () => {
    it('should return all change requests filtered by status', async () => {
      const expected = [{ id: 'cr-1' }];
      service.getAllChangeRequests.mockResolvedValue(expected);
      const query = { status: 'APPROVED' as any };

      const result = await controller.getAllChangeRequests(adminUser, query);

      expect(result).toEqual(expected);
      expect(service.getAllChangeRequests).toHaveBeenCalledWith(
        adminUser.tenantId,
        'APPROVED',
      );
    });

    it('should handle empty query status', async () => {
      service.getAllChangeRequests.mockResolvedValue([]);

      await controller.getAllChangeRequests(adminUser, {});

      expect(service.getAllChangeRequests).toHaveBeenCalledWith(
        adminUser.tenantId,
        undefined,
      );
    });
  });

  // ============================================
  // reviewChangeRequest
  // ============================================
  describe('reviewChangeRequest', () => {
    const dto = { status: 'APPROVED' as any, reviewNote: 'Looks good' };

    it('should review a change request using employeeId', async () => {
      const expected = { id: 'cr-1', status: 'APPROVED' };
      service.reviewChangeRequest.mockResolvedValue(expected);

      const result = await controller.reviewChangeRequest(
        adminUser,
        'cr-1',
        dto,
      );

      expect(result).toEqual(expected);
      expect(service.reviewChangeRequest).toHaveBeenCalledWith(
        adminUser.tenantId,
        'cr-1',
        adminUser.employeeId,
        dto,
      );
    });

    it('should fallback to userId when employeeId is undefined', async () => {
      const adminNoEmp: AuthenticatedUser = {
        ...adminUser,
        employeeId: undefined,
      };
      service.reviewChangeRequest.mockResolvedValue({ id: 'cr-1' });

      await controller.reviewChangeRequest(adminNoEmp, 'cr-1', dto);

      expect(service.reviewChangeRequest).toHaveBeenCalledWith(
        adminNoEmp.tenantId,
        'cr-1',
        adminNoEmp.userId,
        dto,
      );
    });
  });
});
