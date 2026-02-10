import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateChangeRequestDto, ReviewChangeRequestDto } from './dto/change-request.dto';
import { ChangeRequestStatus, NotificationType } from '@prisma/client';

// Fields employees are allowed to request changes for
const ALLOWED_FIELDS = [
  'phone',
  'email',
  'designation',
  'firstName',
  'lastName',
];

@Injectable()
export class SelfServiceService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async getMyProfile(tenantId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      include: {
        department: { select: { name: true, code: true } },
        manager: { select: { firstName: true, lastName: true, employeeCode: true } },
        shiftAssignments: {
          where: { isActive: true },
          include: { shift: { select: { name: true, code: true, startTime: true, endTime: true } } },
          take: 1,
          orderBy: { startDate: 'desc' },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    return employee;
  }

  async createChangeRequest(
    tenantId: string,
    employeeId: string,
    dto: CreateChangeRequestDto,
  ) {
    if (!ALLOWED_FIELDS.includes(dto.fieldName)) {
      throw new BadRequestException(
        `Field "${dto.fieldName}" is not eligible for self-service change. Allowed: ${ALLOWED_FIELDS.join(', ')}`,
      );
    }

    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Check for existing pending request for same field
    const existing = await this.prisma.employeeChangeRequest.findFirst({
      where: {
        tenantId,
        employeeId,
        fieldName: dto.fieldName,
        status: ChangeRequestStatus.PENDING,
      },
    });

    if (existing) {
      throw new BadRequestException(
        `You already have a pending change request for "${dto.fieldName}"`,
      );
    }

    // Get current value
    const oldValue = String((employee as Record<string, unknown>)[dto.fieldName] ?? '');

    return this.prisma.employeeChangeRequest.create({
      data: {
        tenantId,
        employeeId,
        fieldName: dto.fieldName,
        oldValue,
        newValue: dto.newValue,
        reason: dto.reason,
      },
    });
  }

  async getMyChangeRequests(tenantId: string, employeeId: string) {
    return this.prisma.employeeChangeRequest.findMany({
      where: { tenantId, employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getPendingReviews(tenantId: string) {
    return this.prisma.employeeChangeRequest.findMany({
      where: { tenantId, status: ChangeRequestStatus.PENDING },
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getAllChangeRequests(tenantId: string, status?: ChangeRequestStatus) {
    return this.prisma.employeeChangeRequest.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
      },
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
        reviewer: {
          select: { firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewChangeRequest(
    tenantId: string,
    requestId: string,
    reviewerId: string,
    dto: ReviewChangeRequestDto,
  ) {
    const request = await this.prisma.employeeChangeRequest.findFirst({
      where: { id: requestId, tenantId },
    });

    if (!request) {
      throw new NotFoundException('Change request not found');
    }

    if (request.status !== ChangeRequestStatus.PENDING) {
      throw new BadRequestException('This request has already been reviewed');
    }

    // If approved, update the employee field
    if (dto.status === ChangeRequestStatus.APPROVED) {
      await this.prisma.employee.update({
        where: { id: request.employeeId },
        data: { [request.fieldName]: request.newValue },
      });
    }

    const updated = await this.prisma.employeeChangeRequest.update({
      where: { id: requestId },
      data: {
        status: dto.status,
        reviewedBy: reviewerId,
        reviewNote: dto.reviewNote,
        reviewedAt: new Date(),
      },
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
      },
    });

    // Notify the employee
    const isApproved = dto.status === ChangeRequestStatus.APPROVED;
    this.notificationsService.notifyEmployee(
      tenantId,
      request.employeeId,
      isApproved
        ? NotificationType.CHANGE_REQUEST_APPROVED
        : NotificationType.CHANGE_REQUEST_REJECTED,
      isApproved ? 'Profile Change Approved' : 'Profile Change Rejected',
      `Your request to change "${request.fieldName}" has been ${isApproved ? 'approved' : 'rejected'}.${dto.reviewNote ? ' Note: ' + dto.reviewNote : ''}`,
      '/my-profile',
    ).catch(() => {}); // Fire and forget

    return updated;
  }
}
