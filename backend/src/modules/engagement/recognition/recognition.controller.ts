import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';

/** Scaffold shell (Wave E Task 0) — routes are added by WS3. */
@ApiTags('engagement-recognition')
@ApiBearerAuth()
@Controller('engagement/recognition')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecognitionController {}
