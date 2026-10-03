import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TimesheetsService } from './timesheets.service';

/** Weekly timesheets (Keka wave G, WS-T). Scaffold shell. */
@ApiTags('timesheets')
@ApiBearerAuth()
@Controller('timesheets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TimesheetsController {
  constructor(
    private readonly timesheets: TimesheetsService,
  ) {}
}
