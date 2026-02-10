import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SelfServiceService } from './self-service.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('SelfServiceService', () => {
  let service: SelfServiceService;
  let prisma: any;
  let notifications: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelfServiceService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();

    service = module.get<SelfServiceService>(SelfServiceService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================
  // getMyProfile()
  // ============================
  describe('getMyProfile', () => {
    it('should return employee profile with relations', async () => {
      const employee = {
        id: 'emp-1',
        tenantId: 'tenant-1',
        firstName: 'John',
        lastName: 'Doe',
        department: { name: 'Engineering', code: 'ENG' },
        manager: { firstName: 'Jane', lastName: 'Smith', employeeCode: 'M001' },
        shiftAssignments: [],
      };
      prisma.employee.findFirst.mockResolvedValue(employee);

      const result = await service.getMyProfile('tenant-1', 'emp-1');

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'emp-1', tenantId: 'tenant-1' },
        include: expect.objectContaining({
          department: expect.any(Object),
          manager: expect.any(Object),
          shiftAssignments: expect.any(Object),
        }),
      });
      expect(result).toEqual(employee);
    });

    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(service.getMyProfile('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ============================
  // createChangeRequest()
  // ============================
  describe('createChangeRequest', () => {
    const tenantId = 'tenant-1';
    const employeeId = 'emp-1';

    it('should create a change request for allowed field', async () => {
      const employee = { id: employeeId, tenantId, phone: '1234567890' };
      prisma.employee.findFirst.mockResolvedValue(employee);
      prisma.employeeChangeRequest.findFirst.mockResolvedValue(null);

      const created = {
        id: 'cr-1',
        tenantId,
        employeeId,
        fieldName: 'phone',
        oldValue: '1234567890',
        newValue: '0987654321',
        status: 'PENDING',
      };
      prisma.employeeChangeRequest.create.mockResolvedValue(created);

      const result = await service.createChangeRequest(tenantId, employeeId, {
        fieldName: 'phone',
        newValue: '0987654321',
        reason: 'Changed my number',
      });

      expect(prisma.employeeChangeRequest.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          employeeId,
          fieldName: 'phone',
          oldValue: '1234567890',
          newValue: '0987654321',
          reason: 'Changed my number',
        },
      });
      expect(result).toEqual(created);
    });

    it('should throw BadRequestException for disallowed field', async () => {
      await expect(
        service.createChangeRequest(tenantId, employeeId, {
          fieldName: 'salary',
          newValue: '100000',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when employee not found', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.createChangeRequest(tenantId, employeeId, {
          fieldName: 'phone',
          newValue: '111',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when pending request exists for same field', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: employeeId, tenantId, phone: '123' });
      prisma.employeeChangeRequest.findFirst.mockResolvedValue({ id: 'existing-cr' });

      await expect(
        service.createChangeRequest(tenantId, employeeId, {
          fieldName: 'phone',
          newValue: '999',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================
  // getMyChangeRequests()
  // ============================
  describe('getMyChangeRequests', () => {
    it('should return change requests for employee', async () => {
      const requests = [{ id: 'cr-1' }, { id: 'cr-2' }];
      prisma.employeeChangeRequest.findMany.mockResolvedValue(requests);

      const result = await service.getMyChangeRequests('tenant-1', 'emp-1');

      expect(prisma.employeeChangeRequest.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(requests);
    });
  });

  // ============================
  // getPendingReviews()
  // ============================
  describe('getPendingReviews', () => {
    it('should return pending change requests with employee info', async () => {
      const requests = [{ id: 'cr-1', status: 'PENDING', employee: { firstName: 'J' } }];
      prisma.employeeChangeRequest.findMany.mockResolvedValue(requests);

      const result = await service.getPendingReviews('tenant-1');

      expect(prisma.employeeChangeRequest.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', status: 'PENDING' },
        include: {
          employee: {
            select: { firstName: true, lastName: true, employeeCode: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual(requests);
    });
  });

  // ============================
  // getAllChangeRequests()
  // ============================
  describe('getAllChangeRequests', () => {
    it('should return all change requests', async () => {
      prisma.employeeChangeRequest.findMany.mockResolvedValue([]);

      await service.getAllChangeRequests('tenant-1');

      expect(prisma.employeeChangeRequest.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        include: expect.objectContaining({
          employee: expect.any(Object),
          reviewer: expect.any(Object),
        }),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should filter by status when provided', async () => {
      prisma.employeeChangeRequest.findMany.mockResolvedValue([]);

      await service.getAllChangeRequests('tenant-1', 'APPROVED' as any);

      expect(prisma.employeeChangeRequest.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', status: 'APPROVED' },
        include: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  // ============================
  // reviewChangeRequest()
  // ============================
  describe('reviewChangeRequest', () => {
    const tenantId = 'tenant-1';
    const requestId = 'cr-1';
    const reviewerId = 'emp-reviewer';

    const pendingRequest = {
      id: requestId,
      tenantId,
      employeeId: 'emp-1',
      fieldName: 'phone',
      oldValue: '123',
      newValue: '999',
      status: 'PENDING',
    };

    it('should approve and update the employee field', async () => {
      prisma.employeeChangeRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.employee.update.mockResolvedValue({});
      const updated = { ...pendingRequest, status: 'APPROVED', reviewedBy: reviewerId };
      prisma.employeeChangeRequest.update.mockResolvedValue(updated);

      const result = await service.reviewChangeRequest(tenantId, requestId, reviewerId, {
        status: 'APPROVED' as any,
      });

      expect(prisma.employee.update).toHaveBeenCalledWith({
        where: { id: 'emp-1' },
        data: { phone: '999' },
      });
      expect(prisma.employeeChangeRequest.update).toHaveBeenCalledWith({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedBy: reviewerId,
          reviewNote: undefined,
          reviewedAt: expect.any(Date),
        },
        include: {
          employee: {
            select: { firstName: true, lastName: true, employeeCode: true },
          },
        },
      });
      expect(result).toEqual(updated);
    });

    it('should reject without updating employee field', async () => {
      prisma.employeeChangeRequest.findFirst.mockResolvedValue(pendingRequest);
      const updated = { ...pendingRequest, status: 'REJECTED', reviewedBy: reviewerId };
      prisma.employeeChangeRequest.update.mockResolvedValue(updated);

      await service.reviewChangeRequest(tenantId, requestId, reviewerId, {
        status: 'REJECTED' as any,
        reviewNote: 'Not allowed',
      });

      expect(prisma.employee.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when request not found', async () => {
      prisma.employeeChangeRequest.findFirst.mockResolvedValue(null);

      await expect(
        service.reviewChangeRequest(tenantId, 'missing', reviewerId, {
          status: 'APPROVED' as any,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when request already reviewed', async () => {
      prisma.employeeChangeRequest.findFirst.mockResolvedValue({
        ...pendingRequest,
        status: 'APPROVED',
      });

      await expect(
        service.reviewChangeRequest(tenantId, requestId, reviewerId, {
          status: 'APPROVED' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should send notification to employee after review', async () => {
      prisma.employeeChangeRequest.findFirst.mockResolvedValue(pendingRequest);
      prisma.employeeChangeRequest.update.mockResolvedValue({
        ...pendingRequest,
        status: 'APPROVED',
      });

      await service.reviewChangeRequest(tenantId, requestId, reviewerId, {
        status: 'APPROVED' as any,
      });

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        'emp-1',
        expect.any(String),
        expect.any(String),
        expect.stringContaining('phone'),
        '/my-profile',
      );
    });
  });
});
