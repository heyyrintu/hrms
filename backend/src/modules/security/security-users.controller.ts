import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { SecurityUsersService } from './security-users.service';
import { ListSecurityUsersQueryDto, SetUserRolesDto } from './dto/security-users.dto';

/**
 * /security/users and role assignment. Routes added by WS-1 (plan Tasks 1.2–1.3).
 * Security administration stays with the fixed admin roles; it is not a
 * grantable permission (spec P8).
 */
@ApiTags('security')
@ApiBearerAuth()
@Controller('security/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class SecurityUsersController {
  constructor(private readonly service: SecurityUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Search and paginate users for security administration' })
  @ApiResponse({ status: 200, description: 'Success' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListSecurityUsersQueryDto) {
    return this.service.list(user.tenantId, query);
  }

  @Put(':id/roles')
  @ApiOperation({ summary: 'Replace the custom roles assigned to a user' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'A custom role id does not belong to this tenant' })
  @ApiResponse({ status: 404, description: 'User not found' })
  setRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
  ) {
    return this.service.setRoles(user.tenantId, id, dto.customRoleIds, user);
  }
}
