import { Body, Controller, Delete, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SsoProvider, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { SsoConfigService } from './sso-config.service';
import { UpsertSsoConfigDto } from './dto/sso-config.dto';
import { SsoProviderParamPipe } from '../auth/sso/provider-param.pipe';

/**
 * /security/sso/:provider. Routes added by WS-3 (plan Task 3.1).
 * Security administration stays with the fixed admin roles; it is not a
 * grantable permission (spec P8).
 */
@ApiTags('security')
@ApiBearerAuth()
@Controller('security/sso')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class SsoConfigController {
  constructor(private readonly service: SsoConfigService) {}

  @Put(':provider')
  @ApiOperation({ summary: 'Create or update a tenant SSO provider configuration' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Invalid configuration' })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider', SsoProviderParamPipe) provider: SsoProvider,
    @Body() dto: UpsertSsoConfigDto,
  ) {
    return this.service.upsert(user.tenantId, provider, dto, user);
  }

  @Delete(':provider')
  @ApiOperation({ summary: 'Remove a tenant SSO provider configuration' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Last enabled provider while single sign-on is required' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider', SsoProviderParamPipe) provider: SsoProvider,
  ) {
    return this.service.remove(user.tenantId, provider, user);
  }
}
