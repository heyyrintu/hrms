import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { SecuritySettingsService } from './security-settings.service';
import { TwoFactorService } from '../auth/two-factor/two-factor.service';
import { UpdateSecuritySettingsDto } from './dto/security-settings.dto';

/**
 * /security/settings and admin 2FA reset. Routes added by WS-2 (plan Task 2.5).
 * Security administration stays with the fixed admin roles; it is not a
 * grantable permission (spec P8).
 */
@ApiTags('security')
@ApiBearerAuth()
@Controller('security')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class SecuritySettingsController {
  constructor(
    private readonly service: SecuritySettingsService,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'Tenant sign-in policy: SSO-only and per-role 2FA requirement' })
  async getSettings(@CurrentUser() user: AuthenticatedUser) {
    return this.service.view(user.tenantId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Update the tenant sign-in policy' })
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSecuritySettingsDto,
  ) {
    return this.service.update(user.tenantId, dto, user);
  }

  @Post('users/:id/2fa/reset')
  @ApiOperation({ summary: "Clear a user's TOTP secret and recovery codes and sign out their sessions" })
  async resetTwoFactor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.twoFactorService.resetForUser(user.tenantId, id, user);
  }
}
