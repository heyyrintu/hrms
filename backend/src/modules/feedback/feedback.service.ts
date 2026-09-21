import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  FeedbackVisibility,
  NotificationType,
  UserRole,
} from '@prisma/client';
import { CreateFeedbackDto, FeedbackQueryDto } from './dto/feedback.dto';

/**
 * Who each participant is, on every feedback the API returns. Enough to name
 * a person in a list without exposing the rest of their employee record.
 */
const participantSelect = {
  id: true,
  firstName: true,
  lastName: true,
  employeeCode: true,
};

/**
 * The visibilities a third party may read. PRIVATE is deliberately absent:
 * feedback left private is only ever readable by the two people in it and by
 * HR, and no manager view may widen that.
 */
const MANAGER_VISIBLE: FeedbackVisibility[] = [
  FeedbackVisibility.VISIBLE_TO_MANAGER,
  FeedbackVisibility.PUBLIC,
];

@Injectable()
export class FeedbackService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  private isAdmin(role: UserRole) {
    return role === UserRole.HR_ADMIN || role === UserRole.SUPER_ADMIN;
  }

  async create(tenantId: string, senderId: string, dto: CreateFeedbackDto) {
    if (dto.receiverId === senderId) {
      throw new BadRequestException('You cannot give feedback to yourself');
    }

    // Scoped by tenant, so a receiver id borrowed from another tenant reads as
    // a missing employee rather than crossing the boundary.
    const receiver = await this.prisma.employee.findFirst({
      where: { id: dto.receiverId, tenantId },
      select: { id: true },
    });

    if (!receiver) {
      throw new NotFoundException('Employee not found');
    }

    const feedback = await this.prisma.feedback.create({
      data: {
        tenantId,
        senderId,
        receiverId: dto.receiverId,
        content: dto.content,
        type: dto.type,
        visibility: dto.visibility ?? FeedbackVisibility.PRIVATE,
      },
      include: {
        sender: { select: participantSelect },
        receiver: { select: participantSelect },
      },
    });

    await this.notificationsService.notifyEmployee(
      tenantId,
      dto.receiverId,
      NotificationType.FEEDBACK_RECEIVED,
      'New Feedback',
      `${feedback.sender.firstName} ${feedback.sender.lastName} shared feedback with you`,
      '/feedback',
    );

    return feedback;
  }

  async findReceived(
    tenantId: string,
    employeeId: string,
    query: FeedbackQueryDto,
  ) {
    return this.paginate({ tenantId, receiverId: employeeId }, query);
  }

  async findSent(
    tenantId: string,
    employeeId: string,
    query: FeedbackQueryDto,
  ) {
    return this.paginate({ tenantId, senderId: employeeId }, query);
  }

  /**
   * The manager view. A manager sees feedback on the people who report to
   * them, and only where the sender agreed a manager could read it. HR sees
   * the same non-private feedback across the whole tenant.
   */
  async findTeam(
    tenantId: string,
    employeeId: string | undefined,
    role: UserRole,
    query: FeedbackQueryDto,
  ) {
    const where: any = {
      tenantId,
      visibility: { in: MANAGER_VISIBLE },
    };

    if (!this.isAdmin(role)) {
      // Without an employee profile there are no reports to scope to, and an
      // undefined managerId would match every employee in the tenant.
      if (!employeeId) {
        throw new BadRequestException('User is not linked to an employee');
      }
      where.receiver = { managerId: employeeId };
    }

    return this.paginate(where, query);
  }

  async findById(
    tenantId: string,
    id: string,
    employeeId: string | undefined,
    role: UserRole,
  ) {
    const feedback = await this.prisma.feedback.findFirst({
      where: { id, tenantId },
      include: {
        sender: { select: participantSelect },
        receiver: { select: { ...participantSelect, managerId: true } },
      },
    });

    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    const isParticipant =
      feedback.senderId === employeeId || feedback.receiverId === employeeId;
    const isReceiversManager =
      feedback.receiver.managerId === employeeId &&
      MANAGER_VISIBLE.includes(feedback.visibility);

    if (!isParticipant && !isReceiversManager && !this.isAdmin(role)) {
      throw new ForbiddenException(
        'You do not have access to this feedback',
      );
    }

    return feedback;
  }

  async delete(
    tenantId: string,
    id: string,
    employeeId: string | undefined,
    role: UserRole,
  ) {
    const feedback = await this.prisma.feedback.findFirst({
      where: { id, tenantId },
      select: { id: true, senderId: true },
    });

    if (!feedback) {
      throw new NotFoundException('Feedback not found');
    }

    if (feedback.senderId !== employeeId && !this.isAdmin(role)) {
      throw new ForbiddenException('You can only delete feedback you gave');
    }

    await this.prisma.feedback.delete({ where: { id } });
    return { message: 'Feedback deleted' };
  }

  private async paginate(where: any, query: FeedbackQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.feedback.findMany({
        where,
        include: {
          sender: { select: participantSelect },
          receiver: { select: participantSelect },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.feedback.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
