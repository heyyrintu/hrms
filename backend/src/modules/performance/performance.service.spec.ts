import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  createMockPrismaService,
  createMockNotificationsService,
} from '../../test/helpers';

describe('PerformanceService', () => {
  let service: PerformanceService;
  let prisma: any;
  let notifications: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceService,
        { provide: PrismaService, useValue: createMockPrismaService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();

    service = module.get<PerformanceService>(PerformanceService);
    prisma = module.get(PrismaService);
    notifications = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ============================================
  // Review Cycles
  // ============================================

  describe('getCycles', () => {
    it('should return paginated cycles', async () => {
      const cycles = [{ id: 'cycle-1', name: 'Q1 2024' }];
      prisma.reviewCycle.findMany.mockResolvedValue(cycles);
      prisma.reviewCycle.count.mockResolvedValue(1);

      const result = await service.getCycles('tenant-1', {});

      expect(prisma.reviewCycle.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
        include: { _count: { select: { reviews: true } } },
      });
      expect(result).toEqual({
        data: cycles,
        meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
      });
    });

    it('should filter by status', async () => {
      prisma.reviewCycle.findMany.mockResolvedValue([]);
      prisma.reviewCycle.count.mockResolvedValue(0);

      await service.getCycles('tenant-1', { status: 'ACTIVE' as any });

      expect(prisma.reviewCycle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', status: 'ACTIVE' },
        }),
      );
    });
  });

  describe('getCycle', () => {
    it('should return a cycle by id', async () => {
      const cycle = { id: 'cycle-1', tenantId: 'tenant-1', name: 'Q1 2024' };
      prisma.reviewCycle.findFirst.mockResolvedValue(cycle);

      const result = await service.getCycle('tenant-1', 'cycle-1');
      expect(result).toEqual(cycle);
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);

      await expect(service.getCycle('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createCycle', () => {
    it('should create a review cycle', async () => {
      const created = {
        id: 'cycle-1',
        tenantId: 'tenant-1',
        name: 'Q1 2024',
        status: 'DRAFT',
      };
      prisma.reviewCycle.create.mockResolvedValue(created);

      const result = await service.createCycle('tenant-1', {
        name: 'Q1 2024',
        startDate: '2024-01-01',
        endDate: '2024-03-31',
      });

      expect(prisma.reviewCycle.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          name: 'Q1 2024',
          description: undefined,
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-03-31'),
        },
        include: { _count: { select: { reviews: true } } },
      });
      expect(result).toEqual(created);
    });

    it('should throw BadRequestException when endDate is before startDate', async () => {
      await expect(
        service.createCycle('tenant-1', {
          name: 'Bad Cycle',
          startDate: '2024-06-01',
          endDate: '2024-01-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateCycle', () => {
    it('should update a DRAFT cycle', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        tenantId: 'tenant-1',
        status: 'DRAFT',
      });
      const updated = { id: 'cycle-1', name: 'Updated' };
      prisma.reviewCycle.update.mockResolvedValue(updated);

      const result = await service.updateCycle('tenant-1', 'cycle-1', { name: 'Updated' });

      expect(prisma.reviewCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { name: 'Updated' },
        include: { _count: { select: { reviews: true } } },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);

      await expect(
        service.updateCycle('tenant-1', 'missing', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when cycle not DRAFT', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        status: 'ACTIVE',
      });

      await expect(
        service.updateCycle('tenant-1', 'cycle-1', { name: 'X' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteCycle', () => {
    it('should delete a DRAFT cycle', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        tenantId: 'tenant-1',
        status: 'DRAFT',
      });
      prisma.reviewCycle.delete.mockResolvedValue({});

      const result = await service.deleteCycle('tenant-1', 'cycle-1');

      expect(prisma.reviewCycle.delete).toHaveBeenCalledWith({ where: { id: 'cycle-1' } });
      expect(result).toEqual({ message: 'Review cycle deleted' });
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);

      await expect(service.deleteCycle('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when cycle not DRAFT', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        status: 'ACTIVE',
      });

      await expect(service.deleteCycle('tenant-1', 'cycle-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // launchCycle - Complex: uses $transaction
  // ============================================

  describe('launchCycle', () => {
    it('should launch a DRAFT cycle and create reviews for active employees with managers', async () => {
      const cycle = {
        id: 'cycle-1',
        tenantId: 'tenant-1',
        name: 'Q1 2024',
        status: 'DRAFT',
      };
      prisma.reviewCycle.findFirst.mockResolvedValue(cycle);

      const employees = [
        { id: 'emp-1', managerId: 'emp-mgr-1' },
        { id: 'emp-2', managerId: 'emp-mgr-2' },
      ];
      prisma.employee.findMany.mockResolvedValue(employees);

      // $transaction mock calls the callback with prisma itself
      const updatedCycle = { ...cycle, status: 'ACTIVE', _count: { reviews: 2 } };
      prisma.reviewCycle.update.mockResolvedValue(updatedCycle);
      prisma.performanceReview.createMany.mockResolvedValue({ count: 2 });

      const result = await service.launchCycle('tenant-1', 'cycle-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.employee.findMany).toHaveBeenCalledWith({
        where: {
          tenantId: 'tenant-1',
          status: 'ACTIVE',
          managerId: { not: null },
        },
        select: { id: true, managerId: true },
      });
      expect(prisma.reviewCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: 'ACTIVE' },
        include: { _count: { select: { reviews: true } } },
      });
      expect(prisma.performanceReview.createMany).toHaveBeenCalledWith({
        data: [
          { tenantId: 'tenant-1', cycleId: 'cycle-1', employeeId: 'emp-1', reviewerId: 'emp-mgr-1' },
          { tenantId: 'tenant-1', cycleId: 'cycle-1', employeeId: 'emp-2', reviewerId: 'emp-mgr-2' },
        ],
      });
      expect(result).toEqual({ ...updatedCycle, reviewsCreated: 2 });
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);

      await expect(service.launchCycle('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when cycle not DRAFT', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        status: 'ACTIVE',
      });

      await expect(service.launchCycle('tenant-1', 'cycle-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when no eligible employees found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        tenantId: 'tenant-1',
        status: 'DRAFT',
      });
      prisma.employee.findMany.mockResolvedValue([]);

      await expect(service.launchCycle('tenant-1', 'cycle-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should notify all employees after launch', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        tenantId: 'tenant-1',
        name: 'Q1',
        status: 'DRAFT',
      });
      prisma.employee.findMany.mockResolvedValue([
        { id: 'emp-1', managerId: 'mgr-1' },
      ]);
      prisma.reviewCycle.update.mockResolvedValue({ id: 'cycle-1', status: 'ACTIVE', _count: { reviews: 1 } });
      prisma.performanceReview.createMany.mockResolvedValue({ count: 1 });

      await service.launchCycle('tenant-1', 'cycle-1');

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1',
        'emp-1',
        expect.any(String),
        'Performance Review Cycle Launched',
        expect.stringContaining('Q1'),
        '/performance',
      );
    });
  });

  // ============================================
  // completeCycle
  // ============================================

  describe('completeCycle', () => {
    it('should complete an ACTIVE cycle', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        tenantId: 'tenant-1',
        status: 'ACTIVE',
      });
      const updated = { id: 'cycle-1', status: 'COMPLETED' };
      prisma.reviewCycle.update.mockResolvedValue(updated);

      const result = await service.completeCycle('tenant-1', 'cycle-1');

      expect(prisma.reviewCycle.update).toHaveBeenCalledWith({
        where: { id: 'cycle-1' },
        data: { status: 'COMPLETED' },
        include: { _count: { select: { reviews: true } } },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when cycle not found', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue(null);

      await expect(service.completeCycle('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when cycle not ACTIVE', async () => {
      prisma.reviewCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        status: 'DRAFT',
      });

      await expect(service.completeCycle('tenant-1', 'cycle-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ============================================
  // My Reviews
  // ============================================

  describe('getMyReviews', () => {
    it('should return paginated reviews for employee', async () => {
      const reviews = [{ id: 'rev-1' }];
      prisma.performanceReview.findMany.mockResolvedValue(reviews);
      prisma.performanceReview.count.mockResolvedValue(1);

      const result = await service.getMyReviews('tenant-1', 'emp-1', {});

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1' },
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 20,
        include: expect.objectContaining({
          cycle: expect.any(Object),
          reviewer: expect.any(Object),
          _count: expect.any(Object),
        }),
      });
      expect(result.meta).toEqual({ total: 1, page: 1, limit: 20, totalPages: 1 });
    });

    it('should filter by status and cycleId', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([]);
      prisma.performanceReview.count.mockResolvedValue(0);

      await service.getMyReviews('tenant-1', 'emp-1', {
        status: 'PENDING' as any,
        cycleId: 'cycle-1',
      });

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: 'tenant-1',
            employeeId: 'emp-1',
            status: 'PENDING',
            cycleId: 'cycle-1',
          },
        }),
      );
    });
  });

  describe('getReview', () => {
    const review = {
      id: 'rev-1',
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      reviewerId: 'emp-mgr',
      employee: { id: 'emp-1' },
      reviewer: { id: 'emp-mgr' },
      cycle: {},
      goals: [],
    };

    it('should return a review for the employee', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);

      const result = await service.getReview('tenant-1', 'rev-1', 'emp-1', 'EMPLOYEE' as any);
      expect(result).toEqual(review);
    });

    it('should return a review for the reviewer', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);

      const result = await service.getReview('tenant-1', 'rev-1', 'emp-mgr', 'MANAGER' as any);
      expect(result).toEqual(review);
    });

    it('should allow HR_ADMIN access to any review', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);

      const result = await service.getReview('tenant-1', 'rev-1', 'other-emp', 'HR_ADMIN' as any);
      expect(result).toEqual(review);
    });

    it('should allow SUPER_ADMIN access to any review', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);

      const result = await service.getReview('tenant-1', 'rev-1', 'other-emp', 'SUPER_ADMIN' as any);
      expect(result).toEqual(review);
    });

    it('should throw NotFoundException when review not found', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);

      await expect(
        service.getReview('tenant-1', 'missing', 'emp-1', 'EMPLOYEE' as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ForbiddenException when unauthorized user tries to access', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);

      await expect(
        service.getReview('tenant-1', 'rev-1', 'stranger', 'EMPLOYEE' as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ============================================
  // submitSelfReview
  // ============================================

  describe('submitSelfReview', () => {
    it('should submit self-review for a PENDING review', async () => {
      const review = {
        id: 'rev-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        reviewerId: 'emp-mgr',
        status: 'PENDING',
        cycle: { name: 'Q1 2024' },
      };
      prisma.performanceReview.findFirst.mockResolvedValue(review);

      const updated = {
        ...review,
        selfRating: 4,
        selfComments: 'Good quarter',
        status: 'SELF_REVIEW',
      };
      prisma.performanceReview.update.mockResolvedValue(updated);

      const result = await service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', {
        selfRating: 4,
        selfComments: 'Good quarter',
      });

      expect(prisma.performanceReview.findFirst).toHaveBeenCalledWith({
        where: { id: 'rev-1', tenantId: 'tenant-1', employeeId: 'emp-1' },
        include: { cycle: { select: { name: true } } },
      });
      expect(prisma.performanceReview.update).toHaveBeenCalledWith({
        where: { id: 'rev-1' },
        data: {
          selfRating: 4,
          selfComments: 'Good quarter',
          selfSubmittedAt: expect.any(Date),
          status: 'SELF_REVIEW',
        },
        include: {
          cycle: { select: { id: true, name: true, startDate: true, endDate: true } },
          reviewer: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when review not found', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);

      await expect(
        service.submitSelfReview('tenant-1', 'missing', 'emp-1', {
          selfRating: 4,
          selfComments: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when review not PENDING', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue({
        id: 'rev-1',
        status: 'SELF_REVIEW',
        cycle: { name: 'Q1' },
      });

      await expect(
        service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', {
          selfRating: 4,
          selfComments: 'X',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should notify the reviewer after self-review submission', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue({
        id: 'rev-1',
        employeeId: 'emp-1',
        reviewerId: 'emp-mgr',
        status: 'PENDING',
        cycle: { name: 'Q1' },
      });
      prisma.performanceReview.update.mockResolvedValue({ id: 'rev-1', status: 'SELF_REVIEW' });

      await service.submitSelfReview('tenant-1', 'rev-1', 'emp-1', {
        selfRating: 4,
        selfComments: 'Good',
      });

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1',
        'emp-mgr',
        expect.any(String),
        'Self-Review Submitted',
        expect.stringContaining('Q1'),
        '/performance/team',
      );
    });
  });

  // ============================================
  // Team Reviews
  // ============================================

  describe('getTeamReviews', () => {
    it('should return all reviews for HR_ADMIN', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([]);
      prisma.performanceReview.count.mockResolvedValue(0);

      const result = await service.getTeamReviews('tenant-1', 'emp-hr', 'HR_ADMIN' as any, {});

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1' },
        }),
      );
      expect(result.meta.total).toBe(0);
    });

    it('should scope to reviewerId for MANAGER', async () => {
      prisma.performanceReview.findMany.mockResolvedValue([]);
      prisma.performanceReview.count.mockResolvedValue(0);

      await service.getTeamReviews('tenant-1', 'emp-mgr', 'MANAGER' as any, {});

      expect(prisma.performanceReview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: 'tenant-1', reviewerId: 'emp-mgr' },
        }),
      );
    });

    it('should throw BadRequestException when MANAGER has no employeeId', async () => {
      await expect(
        service.getTeamReviews('tenant-1', undefined, 'MANAGER' as any, {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ============================================
  // submitManagerReview
  // ============================================

  describe('submitManagerReview', () => {
    const review = {
      id: 'rev-1',
      tenantId: 'tenant-1',
      employeeId: 'emp-1',
      reviewerId: 'emp-mgr',
      status: 'SELF_REVIEW',
      cycle: { name: 'Q1' },
      employee: { id: 'emp-1', firstName: 'John', lastName: 'Doe' },
    };

    it('should submit manager review for a SELF_REVIEW review', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);
      const updated = { ...review, status: 'COMPLETED', managerRating: 4, overallRating: 4 };
      prisma.performanceReview.update.mockResolvedValue(updated);

      const result = await service.submitManagerReview(
        'tenant-1', 'rev-1', 'emp-mgr', 'MANAGER' as any,
        { managerRating: 4, managerComments: 'Good work', overallRating: 4 },
      );

      expect(prisma.performanceReview.update).toHaveBeenCalledWith({
        where: { id: 'rev-1' },
        data: {
          managerRating: 4,
          managerComments: 'Good work',
          overallRating: 4,
          managerSubmittedAt: expect.any(Date),
          status: 'COMPLETED',
        },
        include: expect.objectContaining({
          cycle: expect.any(Object),
          employee: expect.any(Object),
          reviewer: expect.any(Object),
        }),
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when review not found', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);

      await expect(
        service.submitManagerReview('tenant-1', 'missing', 'emp-mgr', 'MANAGER' as any, {
          managerRating: 4,
          managerComments: 'X',
          overallRating: 4,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when review not SELF_REVIEW', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue({
        ...review,
        status: 'PENDING',
      });

      await expect(
        service.submitManagerReview('tenant-1', 'rev-1', 'emp-mgr', 'MANAGER' as any, {
          managerRating: 4,
          managerComments: 'X',
          overallRating: 4,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ForbiddenException when non-admin is not the assigned reviewer', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);

      await expect(
        service.submitManagerReview('tenant-1', 'rev-1', 'stranger', 'MANAGER' as any, {
          managerRating: 4,
          managerComments: 'X',
          overallRating: 4,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow HR_ADMIN to submit manager review', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);
      prisma.performanceReview.update.mockResolvedValue({ ...review, status: 'COMPLETED' });

      await expect(
        service.submitManagerReview('tenant-1', 'rev-1', 'emp-hr', 'HR_ADMIN' as any, {
          managerRating: 3,
          managerComments: 'OK',
          overallRating: 3,
        }),
      ).resolves.toBeDefined();
    });

    it('should allow SUPER_ADMIN to submit manager review', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);
      prisma.performanceReview.update.mockResolvedValue({ ...review, status: 'COMPLETED' });

      await expect(
        service.submitManagerReview('tenant-1', 'rev-1', 'emp-admin', 'SUPER_ADMIN' as any, {
          managerRating: 5,
          managerComments: 'Excellent',
          overallRating: 5,
        }),
      ).resolves.toBeDefined();
    });

    it('should notify employee after manager review submission', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(review);
      prisma.performanceReview.update.mockResolvedValue({ ...review, status: 'COMPLETED' });

      await service.submitManagerReview(
        'tenant-1', 'rev-1', 'emp-mgr', 'MANAGER' as any,
        { managerRating: 4, managerComments: 'Good', overallRating: 4 },
      );

      expect(notifications.notifyEmployee).toHaveBeenCalledWith(
        'tenant-1',
        'emp-1',
        expect.any(String),
        'Performance Review Completed',
        expect.stringContaining('4/5'),
        '/performance',
      );
    });
  });

  // ============================================
  // Goals
  // ============================================

  describe('getMyGoals', () => {
    it('should return goals for employee', async () => {
      const goals = [{ id: 'goal-1', title: 'Learn TypeScript' }];
      prisma.goal.findMany.mockResolvedValue(goals);

      const result = await service.getMyGoals('tenant-1', 'emp-1');

      expect(prisma.goal.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', employeeId: 'emp-1' },
        orderBy: { createdAt: 'desc' },
        include: {
          review: {
            select: {
              id: true,
              status: true,
              cycle: { select: { id: true, name: true } },
            },
          },
        },
      });
      expect(result).toEqual(goals);
    });
  });

  describe('createGoal', () => {
    it('should create a goal for a non-completed review', async () => {
      const review = { id: 'rev-1', status: 'PENDING', employeeId: 'emp-1' };
      prisma.performanceReview.findFirst.mockResolvedValue(review);

      const created = { id: 'goal-1', title: 'Learn TS', tenantId: 'tenant-1' };
      prisma.goal.create.mockResolvedValue(created);

      const result = await service.createGoal('tenant-1', 'emp-1', {
        reviewId: 'rev-1',
        title: 'Learn TS',
        description: 'Master TypeScript',
        targetDate: '2024-06-30',
        weight: 30,
      });

      expect(prisma.performanceReview.findFirst).toHaveBeenCalledWith({
        where: { id: 'rev-1', tenantId: 'tenant-1', employeeId: 'emp-1' },
      });
      expect(prisma.goal.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          reviewId: 'rev-1',
          employeeId: 'emp-1',
          title: 'Learn TS',
          description: 'Master TypeScript',
          targetDate: new Date('2024-06-30'),
          weight: 30,
        },
        include: {
          review: {
            select: {
              id: true,
              status: true,
              cycle: { select: { id: true, name: true } },
            },
          },
        },
      });
      expect(result).toEqual(created);
    });

    it('should throw BadRequestException when review not found or not owned', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue(null);

      await expect(
        service.createGoal('tenant-1', 'emp-1', {
          reviewId: 'missing',
          title: 'Goal',
          targetDate: '2024-06-30',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when review is COMPLETED', async () => {
      prisma.performanceReview.findFirst.mockResolvedValue({
        id: 'rev-1',
        status: 'COMPLETED',
        employeeId: 'emp-1',
      });

      await expect(
        service.createGoal('tenant-1', 'emp-1', {
          reviewId: 'rev-1',
          title: 'Goal',
          targetDate: '2024-06-30',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateGoal', () => {
    it('should update a goal', async () => {
      prisma.goal.findFirst.mockResolvedValue({
        id: 'goal-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        review: { status: 'SELF_REVIEW' },
      });
      const updated = { id: 'goal-1', title: 'Updated', progress: 50 };
      prisma.goal.update.mockResolvedValue(updated);

      const result = await service.updateGoal('tenant-1', 'goal-1', 'emp-1', {
        title: 'Updated',
        progress: 50,
      });

      expect(prisma.goal.update).toHaveBeenCalledWith({
        where: { id: 'goal-1' },
        data: { title: 'Updated', progress: 50 },
        include: {
          review: {
            select: {
              id: true,
              status: true,
              cycle: { select: { id: true, name: true } },
            },
          },
        },
      });
      expect(result).toEqual(updated);
    });

    it('should throw NotFoundException when goal not found', async () => {
      prisma.goal.findFirst.mockResolvedValue(null);

      await expect(
        service.updateGoal('tenant-1', 'missing', 'emp-1', { title: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteGoal', () => {
    it('should delete a goal from a non-completed review', async () => {
      prisma.goal.findFirst.mockResolvedValue({
        id: 'goal-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        review: { status: 'SELF_REVIEW' },
      });
      prisma.goal.delete.mockResolvedValue({});

      const result = await service.deleteGoal('tenant-1', 'goal-1', 'emp-1');

      expect(prisma.goal.delete).toHaveBeenCalledWith({ where: { id: 'goal-1' } });
      expect(result).toEqual({ message: 'Goal deleted' });
    });

    it('should throw NotFoundException when goal not found', async () => {
      prisma.goal.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteGoal('tenant-1', 'missing', 'emp-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when review is COMPLETED', async () => {
      prisma.goal.findFirst.mockResolvedValue({
        id: 'goal-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        review: { status: 'COMPLETED' },
      });

      await expect(
        service.deleteGoal('tenant-1', 'goal-1', 'emp-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
