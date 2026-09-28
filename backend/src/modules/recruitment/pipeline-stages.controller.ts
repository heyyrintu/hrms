import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/permissions/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PipelineStagesService } from './pipeline-stages.service';
import { ReplacePipelineStagesDto } from './dto/pipeline-stage.dto';

/**
 * Pipeline stages (PUT is HR/SUPER only).
 *   GET /recruitment/pipeline-stages
 *   PUT /recruitment/pipeline-stages
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@RequirePermissions('recruitment.config.manage')
@Controller('recruitment/pipeline-stages')
export class PipelineStagesController {
  constructor(private readonly service: PipelineStagesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(user.tenantId, includeInactive === 'true');
  }

  @Put()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('recruitment.config.manage')
  replace(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReplacePipelineStagesDto) {
    return this.service.replace(user.tenantId, dto.stages);
  }
}
