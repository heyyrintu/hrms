import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { AttendanceRequestsService } from './attendance-requests.service';

/** WFH and on-duty requests (Keka wave G, WS-A). Scaffold shell. */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceRequestsController {
  constructor(
    private readonly requests: AttendanceRequestsService,
  ) {}
}
