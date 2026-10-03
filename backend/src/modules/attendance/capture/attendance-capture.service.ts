import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AttendancePolicyService } from '../policy/attendance-policy.service';
import { UploadsService } from '../../uploads/uploads.service';
import { AttendanceRequestsService } from '../requests/attendance-requests.service';
import { AttendanceService } from '../attendance.service';
import { isIpAllowed } from '../rules/ip-allowlist';
import {
  ATTENDANCE_SELFIE_ENTITY,
  type CoveringRequest,
} from '../requests/attendance-requests.types';

const NO_EMPLOYEE = 'No employee record linked to this user';
const SELFIE_MAX_BYTES = 2 * 1024 * 1024;
const SELFIE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface CapturePolicyStatus {
  ipRestrictionEnabled: boolean;
  ipAllowed: boolean;
  selfieRequired: boolean;
  coveringRequest: CoveringRequest | null;
  clientIp: string | null;
}

/** Capture policy status and attendance selfies (Keka wave G, WS-A). */
@Injectable()
export class AttendanceCaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AttendancePolicyService,
    private readonly uploads: UploadsService,
    private readonly requests: AttendanceRequestsService,
    private readonly attendance: AttendanceService,
  ) {}

  /**
   * What the clock UI needs before a punch: the policy, whether this client
   * IP passes it, and the approved request covering the caller's CURRENT
   * shift day (an open night shift is yesterday's day, not today's).
   */
  async getPolicyStatus(
    actor: AuthenticatedUser,
    ip: string | undefined,
  ): Promise<CapturePolicyStatus> {
    if (!actor.employeeId) throw new BadRequestException(NO_EMPLOYEE);
    const policy = await this.policyService.getOrCreate(actor.tenantId);
    const shiftDate = await this.attendance.currentShiftDate(actor.tenantId, actor.employeeId);
    const coveringRequest = await this.requests.findApprovedCovering(
      actor.tenantId,
      actor.employeeId,
      shiftDate,
    );
    return {
      ipRestrictionEnabled: policy.ipRestrictionEnabled,
      ipAllowed: isIpAllowed(ip, policy.allowedIpRanges ?? []),
      selfieRequired: policy.selfieRequired,
      coveringRequest,
      clientIp: ip ?? null,
    };
  }

  /** Store one selfie (JPEG/PNG/WebP, at most 2 MB); a punch claims it by id. */
  async uploadSelfie(
    actor: AuthenticatedUser,
    file: Express.Multer.File | undefined,
  ): Promise<{ uploadId: string }> {
    if (!file) throw new BadRequestException('A selfie image is required');
    if (!SELFIE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Selfie must be a JPEG, PNG or WebP image');
    }
    if (file.size > SELFIE_MAX_BYTES) {
      throw new BadRequestException('Selfie must be 2 MB or smaller');
    }
    const upload = await this.uploads.upload(
      file,
      actor.tenantId,
      actor.userId,
      ATTENDANCE_SELFIE_ENTITY,
    );
    return { uploadId: upload.id };
  }

  /**
   * The file behind one session's in/out selfie. Visible to the employee, their
   * direct manager, HR_ADMIN and SUPER_ADMIN; every other case is a 404, so the
   * route never confirms that a selfie exists.
   */
  async getSelfie(
    actor: AuthenticatedUser,
    sessionId: string,
    which: 'in' | 'out',
  ): Promise<{ path: string; mimeType: string }> {
    const notFound = () => new NotFoundException('Selfie not found');
    const tenantId = actor.tenantId;

    const session = await this.prisma.attendanceSession.findFirst({
      where: { id: sessionId, tenantId },
      select: {
        inSelfieUploadId: true,
        outSelfieUploadId: true,
        attendance: { select: { employeeId: true } },
      },
    });
    const uploadId = which === 'in' ? session?.inSelfieUploadId : session?.outSelfieUploadId;
    if (!session || !uploadId) throw notFound();

    const ownerId = session.attendance.employeeId;
    const isAdmin = actor.role === UserRole.HR_ADMIN || actor.role === UserRole.SUPER_ADMIN;
    // An undefined employeeId must never reach a where clause or an equality.
    const isSelf = !!actor.employeeId && actor.employeeId === ownerId;
    let allowed = isAdmin || isSelf;
    if (!allowed && actor.employeeId) {
      const report = await this.prisma.employee.findFirst({
        where: { id: ownerId, tenantId, managerId: actor.employeeId },
        select: { id: true },
      });
      allowed = !!report;
    }
    if (!allowed) throw notFound();

    const upload = await this.prisma.upload.findFirst({
      where: { id: uploadId, tenantId, entityType: ATTENDANCE_SELFIE_ENTITY },
      select: { key: true, mimeType: true },
    });
    if (!upload) throw notFound();

    return {
      path: await this.uploads.getFilePath(upload.key, tenantId),
      mimeType: upload.mimeType,
    };
  }
}
