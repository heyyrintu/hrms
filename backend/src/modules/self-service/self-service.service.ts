import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateChangeRequestDto, ReviewChangeRequestDto } from './dto/change-request.dto';
import { ChangeRequestStatus, NotificationType } from '@prisma/client';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { assertValidAadhaar } from '../../common/validation/aadhaar';

/** Fields that are stored encrypted and must only ever be shown masked. */
const ENCRYPTED_FIELDS = new Set(['aadhaarNumber']);

// Fields employees are allowed to request changes for
const ALLOWED_FIELDS = [
  'phone',
  'email',
  'firstName',
  'lastName',
  'mobileNumber',
  'personalEmail',
  'currentAddress',
  'currentCity',
  'currentState',
  'currentZipCode',
  'currentCountry',
  'permanentAddress',
  'permanentCity',
  'permanentState',
  'permanentZipCode',
  'permanentCountry',
  'emergencyContactName',
  'emergencyContactNumber',
  'emergencyContactRelation',
  'bloodGroup',
  'maritalStatus',
  'fatherName',
  'aadhaarNumber',
  'gender',
];

@Injectable()
export class SelfServiceService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private crypto: FieldEncryptionService,
  ) {}

  /** Old value for the audit row: masked when the field is encrypted. */
  private currentValueFor(employee: Record<string, unknown>, fieldName: string): string {
    const raw = employee[fieldName];
    if (ENCRYPTED_FIELDS.has(fieldName)) {
      return this.crypto.mask(raw as string | null | undefined) ?? '';
    }
    return String(raw ?? '');
  }

  /**
   * New value as it will be written to the employee row on approval.
   * Encrypted fields are validated first: the profile response only carries the
   * masked form, so an edit form prefilled from it must not be able to post the
   * mask back and have it encrypted over the real number.
   */
  private storableValueFor(fieldName: string, newValue: string): string {
    if (!ENCRYPTED_FIELDS.has(fieldName)) return newValue;
    if (fieldName === 'aadhaarNumber') {
      return this.crypto.encrypt(assertValidAadhaar(newValue));
    }
    return this.crypto.encrypt(newValue);
  }

  /** Never leak an encrypted blob through change-request listings. */
  private redactRequest<T extends { fieldName: string; newValue: string; oldValue: string | null }>(
    req: T,
  ): T {
    if (!ENCRYPTED_FIELDS.has(req.fieldName)) return req;
    return {
      ...req,
      oldValue: this.crypto.mask(req.oldValue) ?? null,
      newValue: this.crypto.mask(req.newValue) ?? '',
    };
  }

  private redactProfile<T extends { aadhaarNumber?: string | null }>(employee: T): T {
    if (employee.aadhaarNumber === undefined) return employee;
    return { ...employee, aadhaarNumber: this.crypto.mask(employee.aadhaarNumber) };
  }

  private assertFieldAllowed(fieldName: string): void {
    if (!ALLOWED_FIELDS.includes(fieldName)) {
      throw new BadRequestException(
        `Field "${fieldName}" is not eligible for self-service change. Allowed: ${ALLOWED_FIELDS.join(', ')}`,
      );
    }
  }

  private async findEmployeeOrThrow(employeeId: string, tenantId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  async getMyProfile(tenantId: string, employeeId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, tenantId },
      include: {
        department: { select: { name: true, code: true } },
        designation: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
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

    return this.redactProfile(employee);
  }

  async createChangeRequest(
    tenantId: string,
    employeeId: string,
    dto: CreateChangeRequestDto,
  ) {
    this.assertFieldAllowed(dto.fieldName);

    const employee = await this.findEmployeeOrThrow(employeeId, tenantId);

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

    return this.prisma.employeeChangeRequest.create({
      data: {
        tenantId,
        employeeId,
        fieldName: dto.fieldName,
        oldValue: this.currentValueFor(employee as Record<string, unknown>, dto.fieldName),
        newValue: this.storableValueFor(dto.fieldName, dto.newValue),
        reason: dto.reason,
      },
    });
  }

  async createBatchChangeRequests(
    tenantId: string,
    employeeId: string,
    changes: CreateChangeRequestDto[],
  ) {
    // Validate all fields first
    for (const change of changes) {
      this.assertFieldAllowed(change.fieldName);
    }

    // Reject duplicate field names in the same batch
    const fieldNames = changes.map(c => c.fieldName);
    const uniqueFields = new Set(fieldNames);
    if (uniqueFields.size !== fieldNames.length) {
      throw new BadRequestException('Duplicate field names in batch request are not allowed');
    }

    const employee = await this.findEmployeeOrThrow(employeeId, tenantId);

    // Check for existing pending requests for any of the fields
    const existingPending = await this.prisma.employeeChangeRequest.findMany({
      where: {
        tenantId,
        employeeId,
        fieldName: { in: fieldNames },
        status: ChangeRequestStatus.PENDING,
      },
    });

    if (existingPending.length > 0) {
      const pendingFields = existingPending.map(p => p.fieldName).join(', ');
      throw new BadRequestException(
        `You already have pending change requests for: ${pendingFields}`,
      );
    }

    // Create all change requests in a transaction
    return this.prisma.$transaction(
      changes.map(change =>
        this.prisma.employeeChangeRequest.create({
          data: {
            tenantId,
            employeeId,
            fieldName: change.fieldName,
            oldValue: this.currentValueFor(employee as Record<string, unknown>, change.fieldName),
            newValue: this.storableValueFor(change.fieldName, change.newValue),
            reason: change.reason,
          },
        }),
      ),
    );
  }

  async getMyChangeRequests(tenantId: string, employeeId: string) {
    const rows = await this.prisma.employeeChangeRequest.findMany({
      where: { tenantId, employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.redactRequest(r));
  }

  async getPendingReviews(tenantId: string) {
    const rows = await this.prisma.employeeChangeRequest.findMany({
      where: { tenantId, status: ChangeRequestStatus.PENDING },
      include: {
        employee: {
          select: { firstName: true, lastName: true, employeeCode: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.redactRequest(r));
  }

  async getAllChangeRequests(tenantId: string, status?: ChangeRequestStatus) {
    const rows = await this.prisma.employeeChangeRequest.findMany({
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
    return rows.map((r) => this.redactRequest(r));
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

    // Wrap employee update + status update in a transaction for atomicity
    const updated = await this.prisma.$transaction(async (tx) => {
      // If approved, update the employee field
      if (dto.status === ChangeRequestStatus.APPROVED) {
        await tx.employee.update({
          where: { id: request.employeeId },
          data: { [request.fieldName]: request.newValue },
        });
      }

      return tx.employeeChangeRequest.update({
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
