import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AttendanceCaptureService } from './attendance-capture.service';

/** Capture policy and selfies (Keka wave G, WS-A). Scaffold shell. */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance-capture')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceCaptureController {
  constructor(
    private readonly capture: AttendanceCaptureService,
  ) {}
}
