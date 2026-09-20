import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
  mockEmployee,
  mockManager,
  mockHrAdmin,
  mockSuperAdmin,
} from '../../test/helpers';
import {
  FeedbackType,
  FeedbackVisibility,
  NotificationType,
  UserRole,
} from '@prisma/client';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let prisma: any;
  let notificationsService: any;

  const tenantId = 'tenant-1';
  // The fixture types employeeId as optional; these paths require one.
  const senderId = mockEmployee.employeeId as string;

  const participantSelect = {
    id: true,
    firstName: true,
    lastName: true,
    employeeCode: true,
  };

  const participantInclude = {
    sender: { select: participantSelect },
    receiver: { select: participantSelect },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        {
          provide: NotificationsService,
          useValue: createMockNotificationsService(),
        },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
    prisma = module.get(PrismaService);
    notificationsService = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // create
  // ============================================

  describe('create', () => {
    const dto = {
      receiverId: 'emp-2',
      content: 'Handled the migration calmly',
      type: FeedbackType.POSITIVE,
      visibility: FeedbackVisibility.VISIBLE_TO_MANAGER,
    };

    it('should create feedback and notify the receiver', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-2' });
      const created = {
        id: 'fb-1',
        tenantId,
        senderId: senderId,
        ...dto,
        sender: { id: 'emp-1', firstName: 'Asha', lastName: 'Rao' },
        receiver: { id: 'emp-2', firstName: 'Vikram', lastName: 'Singh' },
      };
      prisma.feedback.create.mockResolvedValue(created);

      const result = await service.create(
        tenantId,
        senderId,
        dto,
      );

      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: 'emp-2', tenantId },
        select: { id: true },
      });
      expect(prisma.feedback.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          senderId: senderId,
          receiverId: 'emp-2',
          content: dto.content,
          type: FeedbackType.POSITIVE,
          visibility: FeedbackVisibility.VISIBLE_TO_MANAGER,
        },
        include: participantInclude,
      });
      expect(notificationsService.notifyEmployee).toHaveBeenCalledWith(
        tenantId,
        'emp-2',
        NotificationType.FEEDBACK_RECEIVED,
        'New Feedback',
        'Asha Rao shared feedback with you',
        '/feedback',
      );
      expect(result).toEqual(created);
    });

    it('should default visibility to PRIVATE when none is given', async () => {
      prisma.employee.findFirst.mockResolvedValue({ id: 'emp-2' });
      prisma.feedback.create.mockResolvedValue({
        id: 'fb-2',
        sender: { firstName: 'Asha', lastName: 'Rao' },
      });

      await service.create(tenantId, senderId, {
        receiverId: 'emp-2',
        content: 'Kept the runbook up to date',
        type: FeedbackType.GENERAL,
      });

      expect(prisma.feedback.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            visibility: FeedbackVisibility.PRIVATE,
          }),
        }),
      );
    });

    it('should reject feedback addressed to yourself', async () => {
      await expect(
        service.create(tenantId, 'emp-1', { ...dto, receiverId: 'emp-1' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.feedback.create).not.toHaveBeenCalled();
    });

    it('should reject a receiver who is not in the tenant', async () => {
      prisma.employee.findFirst.mockResolvedValue(null);

      await expect(
        service.create(tenantId, senderId, dto),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.feedback.create).not.toHaveBeenCalled();
      expect(notificationsService.notifyEmployee).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // findReceived / findSent
  // ============================================

  describe('findReceived', () => {
    it('should page feedback where the caller is the receiver', async () => {
      prisma.feedback.findMany.mockResolvedValue([{ id: 'fb-1' }]);
      prisma.feedback.count.mockResolvedValue(11);

      const result = await service.findReceived(
        tenantId,
        senderId,
        { page: 2, limit: 10 },
      );

      expect(prisma.feedback.findMany).toHaveBeenCalledWith({
        where: { tenantId, receiverId: senderId },
        include: participantInclude,
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(result).toEqual({
        data: [{ id: 'fb-1' }],
        meta: { total: 11, page: 2, limit: 10, totalPages: 2 },
      });
    });

    it('should default to page 1 with a limit of 10', async () => {
      prisma.feedback.findMany.mockResolvedValue([]);
      prisma.feedback.count.mockResolvedValue(0);

      const result = await service.findReceived(
        tenantId,
        senderId,
        {},
      );

      expect(prisma.feedback.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(result.meta).toEqual({
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      });
    });
  });

  describe('findSent', () => {
    it('should page feedback where the caller is the sender', async () => {
      prisma.feedback.findMany.mockResolvedValue([]);
      prisma.feedback.count.mockResolvedValue(0);

      await service.findSent(tenantId, senderId, {});

      expect(prisma.feedback.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, senderId: senderId },
        }),
      );
    });
  });

  // ============================================
  // findTeam
  // ============================================

  describe('findTeam', () => {
    it('should scope a manager to their own reports and hide private feedback', async () => {
      prisma.feedback.findMany.mockResolvedValue([]);
      prisma.feedback.count.mockResolvedValue(0);

      await service.findTeam(
        tenantId,
        mockManager.employeeId,
        UserRole.MANAGER,
        {},
      );

      expect(prisma.feedback.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            visibility: {
              in: [
                FeedbackVisibility.VISIBLE_TO_MANAGER,
                FeedbackVisibility.PUBLIC,
              ],
            },
            receiver: { managerId: mockManager.employeeId },
          },
        }),
      );
    });

    it('should never let PRIVATE feedback into the manager view', async () => {
      prisma.feedback.findMany.mockResolvedValue([]);
      prisma.feedback.count.mockResolvedValue(0);

      await service.findTeam(
        tenantId,
        mockManager.employeeId,
        UserRole.MANAGER,
        {},
      );

      const where = prisma.feedback.findMany.mock.calls[0][0].where;
      expect(where.visibility.in).not.toContain(FeedbackVisibility.PRIVATE);
    });

    it('should let HR see non-private feedback across the tenant', async () => {
      prisma.feedback.findMany.mockResolvedValue([]);
      prisma.feedback.count.mockResolvedValue(0);

      await service.findTeam(
        tenantId,
        mockHrAdmin.employeeId,
        UserRole.HR_ADMIN,
        {},
      );

      const where = prisma.feedback.findMany.mock.calls[0][0].where;
      expect(where.receiver).toBeUndefined();
      expect(where.visibility.in).not.toContain(FeedbackVisibility.PRIVATE);
    });

    it('should refuse a manager with no employee profile rather than list the tenant', async () => {
      await expect(
        service.findTeam(tenantId, undefined, UserRole.MANAGER, {}),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.feedback.findMany).not.toHaveBeenCalled();
    });

    it('should let a super admin see non-private feedback across the tenant', async () => {
      prisma.feedback.findMany.mockResolvedValue([]);
      prisma.feedback.count.mockResolvedValue(0);

      await service.findTeam(
        tenantId,
        mockSuperAdmin.employeeId,
        UserRole.SUPER_ADMIN,
        {},
      );

      expect(
        prisma.feedback.findMany.mock.calls[0][0].where.receiver,
      ).toBeUndefined();
    });
  });

  // ============================================
  // findById
  // ============================================

  describe('findById', () => {
    const base = {
      id: 'fb-1',
      tenantId,
      senderId: 'emp-1',
      receiverId: 'emp-2',
      visibility: FeedbackVisibility.PRIVATE,
      sender: { id: 'emp-1', firstName: 'Asha', lastName: 'Rao' },
      receiver: {
        id: 'emp-2',
        firstName: 'Vikram',
        lastName: 'Singh',
        managerId: mockManager.employeeId,
      },
    };

    it('should throw when the feedback is not in the tenant', async () => {
      prisma.feedback.findFirst.mockResolvedValue(null);

      await expect(
        service.findById(tenantId, 'fb-x', 'emp-1', UserRole.EMPLOYEE),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return it to the sender', async () => {
      prisma.feedback.findFirst.mockResolvedValue(base);

      const result = await service.findById(
        tenantId,
        'fb-1',
        'emp-1',
        UserRole.EMPLOYEE,
      );

      expect(result).toEqual(base);
    });

    it('should return it to the receiver even when private', async () => {
      prisma.feedback.findFirst.mockResolvedValue(base);

      await expect(
        service.findById(tenantId, 'fb-1', 'emp-2', UserRole.EMPLOYEE),
      ).resolves.toEqual(base);
    });

    it('should hide private feedback from the manager of the receiver', async () => {
      prisma.feedback.findFirst.mockResolvedValue(base);

      await expect(
        service.findById(
          tenantId,
          'fb-1',
          mockManager.employeeId,
          UserRole.MANAGER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should show the manager feedback marked VISIBLE_TO_MANAGER', async () => {
      prisma.feedback.findFirst.mockResolvedValue({
        ...base,
        visibility: FeedbackVisibility.VISIBLE_TO_MANAGER,
      });

      await expect(
        service.findById(
          tenantId,
          'fb-1',
          mockManager.employeeId,
          UserRole.MANAGER,
        ),
      ).resolves.toBeDefined();
    });

    it('should hide it from an unrelated manager', async () => {
      prisma.feedback.findFirst.mockResolvedValue({
        ...base,
        visibility: FeedbackVisibility.PUBLIC,
        receiver: { ...base.receiver, managerId: 'emp-other-mgr' },
      });

      await expect(
        service.findById(
          tenantId,
          'fb-1',
          mockManager.employeeId,
          UserRole.MANAGER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should show it to HR even when private', async () => {
      prisma.feedback.findFirst.mockResolvedValue(base);

      await expect(
        service.findById(
          tenantId,
          'fb-1',
          mockHrAdmin.employeeId,
          UserRole.HR_ADMIN,
        ),
      ).resolves.toEqual(base);
    });

    it('should hide it from an uninvolved employee', async () => {
      prisma.feedback.findFirst.mockResolvedValue({
        ...base,
        visibility: FeedbackVisibility.PUBLIC,
      });

      await expect(
        service.findById(tenantId, 'fb-1', 'emp-99', UserRole.EMPLOYEE),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================
  // delete
  // ============================================

  describe('delete', () => {
    it('should throw when the feedback is not in the tenant', async () => {
      prisma.feedback.findFirst.mockResolvedValue(null);

      await expect(
        service.delete(tenantId, 'fb-x', 'emp-1', UserRole.EMPLOYEE),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.feedback.delete).not.toHaveBeenCalled();
    });

    it('should let the sender delete their own feedback', async () => {
      prisma.feedback.findFirst.mockResolvedValue({
        id: 'fb-1',
        senderId: 'emp-1',
      });

      const result = await service.delete(
        tenantId,
        'fb-1',
        'emp-1',
        UserRole.EMPLOYEE,
      );

      expect(prisma.feedback.delete).toHaveBeenCalledWith({
        where: { id: 'fb-1' },
      });
      expect(result).toEqual({ message: 'Feedback deleted' });
    });

    it('should let HR delete any feedback', async () => {
      prisma.feedback.findFirst.mockResolvedValue({
        id: 'fb-1',
        senderId: 'emp-1',
      });

      await service.delete(
        tenantId,
        'fb-1',
        mockHrAdmin.employeeId,
        UserRole.HR_ADMIN,
      );

      expect(prisma.feedback.delete).toHaveBeenCalled();
    });

    it('should refuse the receiver, who did not write it', async () => {
      prisma.feedback.findFirst.mockResolvedValue({
        id: 'fb-1',
        senderId: 'emp-1',
      });

      await expect(
        service.delete(tenantId, 'fb-1', 'emp-2', UserRole.EMPLOYEE),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.feedback.delete).not.toHaveBeenCalled();
    });

    it('should refuse a manager who did not write it', async () => {
      prisma.feedback.findFirst.mockResolvedValue({
        id: 'fb-1',
        senderId: 'emp-1',
      });

      await expect(
        service.delete(
          tenantId,
          'fb-1',
          mockManager.employeeId,
          UserRole.MANAGER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
