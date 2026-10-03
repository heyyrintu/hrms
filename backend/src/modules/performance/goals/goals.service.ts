import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateGoalDto, UpdateGoalDto } from './dto/goals.dto';
import { PerformanceReviewStatus, GoalStatus } from '@prisma/client';

@Injectable()
export class GoalsService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // Goals (Employee)
  // ============================================

  async getMyGoals(tenantId: string, employeeId: string) {
    return this.prisma.goal.findMany({
      where: { tenantId, employeeId },
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
  }

  async createGoal(tenantId: string, employeeId: string, dto: CreateGoalDto) {
    // Verify the review belongs to this employee
    const review = await this.prisma.performanceReview.findFirst({
      where: { id: dto.reviewId, tenantId, employeeId },
    });
    if (!review) {
      throw new BadRequestException('Review not found or does not belong to you');
    }
    if (review.status === PerformanceReviewStatus.COMPLETED) {
      throw new BadRequestException('Cannot add goals to a completed review');
    }

    return this.prisma.goal.create({
      data: {
        tenantId,
        reviewId: dto.reviewId,
        employeeId,
        title: dto.title,
        description: dto.description,
        targetDate: new Date(dto.targetDate),
        weight: dto.weight,
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
  }

  async updateGoal(
    tenantId: string,
    goalId: string,
    employeeId: string,
    dto: UpdateGoalDto,
  ) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId, employeeId },
      include: { review: { select: { status: true } } },
    });
    if (!goal) throw new NotFoundException('Goal not found');

    // A signed-off review is a record. deleteGoal already refuses this; leaving
    // update open let progress and weight be rewritten after the fact.
    if (goal.review?.status === PerformanceReviewStatus.COMPLETED) {
      throw new BadRequestException(
        'This review is completed; its goals can no longer be changed',
      );
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.targetDate !== undefined) data.targetDate = new Date(dto.targetDate);
    if (dto.status !== undefined) data.status = dto.status as GoalStatus;
    if (dto.progress !== undefined) data.progress = dto.progress;
    if (dto.weight !== undefined) data.weight = dto.weight;

    return this.prisma.goal.update({
      where: { id: goalId },
      data,
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
  }

  async deleteGoal(tenantId: string, goalId: string, employeeId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, tenantId, employeeId },
      include: { review: { select: { status: true } } },
    });
    if (!goal) throw new NotFoundException('Goal not found');
    if (goal.review?.status === PerformanceReviewStatus.COMPLETED) {
      throw new BadRequestException('Cannot delete goals from a completed review');
    }

    await this.prisma.goal.delete({ where: { id: goalId } });
    return { message: 'Goal deleted' };
  }
}
