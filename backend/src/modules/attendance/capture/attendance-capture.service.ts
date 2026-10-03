import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AttendancePolicyService } from '../policy/attendance-policy.service';
import { UploadsService } from '../../uploads/uploads.service';
import { AttendanceRequestsService } from '../requests/attendance-requests.service';

/** Capture policy status and attendance selfies (Keka wave G, WS-A). Scaffold stub. */
@Injectable()
export class AttendanceCaptureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: AttendancePolicyService,
    private readonly uploads: UploadsService,
    private readonly requests: AttendanceRequestsService,
  ) {}

  getPolicyStatus(): never {
    throw new NotImplementedException();
  }
}
