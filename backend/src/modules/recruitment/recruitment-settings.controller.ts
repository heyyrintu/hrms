import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/permissions/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { RecruitmentSettingsService } from './recruitment-settings.service';
import { UpdateRecruitmentSettingsDto } from './dto/settings.dto';

/**
 * Hiring settings (HR/SUPER): careers page switch, expiries, pre-onboarding checklist.
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@RequirePermissions('recruitment.config.manage')
@Controller('recruitment/settings')
export class RecruitmentSettingsController {
  constructor(private readonly service: RecruitmentSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get hiring settings' })
  @ApiResponse({ status: 200 })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.service.get(user.tenantId);
  }

  @Put()
  @ApiOperation({ summary: 'Update hiring settings' })
  @ApiResponse({ status: 200 })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateRecruitmentSettingsDto) {
    return this.service.update(user.tenantId, dto);
  }
}
