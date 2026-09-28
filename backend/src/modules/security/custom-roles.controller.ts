import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PERMISSIONS } from '../../common/permissions/permissions';
import { CustomRolesService } from './custom-roles.service';
import { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto/custom-role.dto';

/**
 * /security/roles and /security/permissions. Routes added by WS-1 (plan Tasks 1.1–1.3).
 * Security administration stays with the fixed admin roles; it is not a
 * grantable permission (spec P8).
 */
@ApiTags('security')
@ApiBearerAuth()
@Controller('security')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class CustomRolesController {
  constructor(private readonly service: CustomRolesService) {}

  @Get('permissions')
  @ApiOperation({ summary: 'List the grantable permission catalogue' })
  @ApiResponse({ status: 200, description: 'Success' })
  getPermissions() {
    return PERMISSIONS;
  }

  @Get('roles')
  @ApiOperation({ summary: 'List custom roles for the tenant' })
  @ApiResponse({ status: 200, description: 'Success' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.tenantId);
  }

  @Post('roles')
  @ApiOperation({ summary: 'Create a custom role' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Invalid permissions or empty list' })
  @ApiResponse({ status: 409, description: 'A role with this name already exists' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomRoleDto) {
    return this.service.create(user.tenantId, user, dto);
  }

  @Patch('roles/:id')
  @ApiOperation({ summary: 'Update a custom role' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'A role with this name already exists' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    return this.service.update(user.tenantId, id, user, dto);
  }

  @Delete('roles/:id')
  @ApiOperation({ summary: 'Delete a custom role' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user.tenantId, id, user);
  }
}
