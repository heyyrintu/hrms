import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PipelineStagesService } from './pipeline-stages.service';

/**
 * Pipeline stages (PUT is HR/SUPER only).
 * Scaffold shell (Keka wave D) — WS-D1 adds the routes:
 *   GET /recruitment/pipeline-stages
 *   PUT /recruitment/pipeline-stages
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/pipeline-stages')
export class PipelineStagesController {
  constructor(private readonly service: PipelineStagesService) {}
}
