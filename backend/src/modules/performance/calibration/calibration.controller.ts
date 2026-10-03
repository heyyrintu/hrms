import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CalibrationService } from './calibration.service';

/** Calibration and 9-box (spec F6, F7). Shell from the Keka wave F scaffold; routes are added per workstream. */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CalibrationController {
  constructor(private calibrationService: CalibrationService) {}
}
