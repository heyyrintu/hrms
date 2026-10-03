import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { GoalsService } from './goals.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { createMockPrismaService } from '../../../test/helpers';

describe('GoalsService', () => {
  let service: GoalsService;
  let prisma: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoalsService,
        { provide: PrismaService, useValue: createMockPrismaService() },
      ],
    }).compile();

    service = module.get<GoalsService>(GoalsService);
    prisma = module.get(PrismaService);
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
    it('should refuse to edit a goal once its review is COMPLETED', async () => {
      // deleteGoal already blocks this; leaving update open let progress and
      // weight be rewritten after the review was signed off.
      prisma.goal.findFirst.mockResolvedValue({
        id: 'goal-1',
        tenantId: 'tenant-1',
        employeeId: 'emp-1',
        review: { status: 'COMPLETED' },
      });

      await expect(
        service.updateGoal('tenant-1', 'goal-1', 'emp-1', { progress: 100 }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.goal.update).not.toHaveBeenCalled();
    });

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
