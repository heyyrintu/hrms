import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { EngagementSettingsService } from './engagement-settings.service';
import { UpdateEngagementSettingsDto } from './dto/engagement-settings.dto';

@ApiTags('engagement-settings')
@ApiBearerAuth()
@Controller('engagement/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EngagementSettingsController {
  constructor(private readonly settingsService: EngagementSettingsService) {}

  /**
   * Tenant engagement settings (defaults when never saved)
   * GET /api/engagement/settings
   */
  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
  @ApiOperation({ summary: 'Get engagement settings for the tenant' })
  @ApiResponse({ status: 200, description: 'Current settings' })
  get(@CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.get(user.tenantId);
  }

  /**
   * Update engagement settings (partial)
   * PUT /api/engagement/settings
   */
  @Put()
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update engagement settings (HR/Super admin)' })
  @ApiResponse({ status: 200, description: 'Updated settings' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 403, description: 'Role not allowed' })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateEngagementSettingsDto) {
    return this.settingsService.update(user.tenantId, dto);
  }
}
