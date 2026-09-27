import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { PreOnboardingService } from './pre-onboarding.service';
import { CreatePreOnboardingDto } from './dto/pre-onboarding.dto';

/**
 * Pre-onboarding invites, HR side (HR/SUPER).
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@Controller('recruitment/pre-onboarding')
export class PreOnboardingController {
  constructor(private readonly service: PreOnboardingService) {}

  @Post()
  @ApiOperation({ summary: 'Invite an employee to pre-onboarding' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 409, description: 'The employee already has a live invite' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePreOnboardingDto) {
    return this.service.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List pre-onboarding invites' })
  @ApiResponse({ status: 200 })
  list(@CurrentUser() user: AuthenticatedUser, @Query('status') status?: string) {
    return this.service.list(user.tenantId, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a pre-onboarding invite' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post(':id/revoke')
  @ApiOperation({ summary: 'Revoke a live pre-onboarding invite' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Not a live invite' })
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.revoke(user, id);
  }

  @Post(':id/resend')
  @ApiOperation({ summary: 'Resend the invite with a new link' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Not a live invite' })
  resend(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.resend(user, id);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark a submitted invite reviewed and complete' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Not submitted yet' })
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.complete(user, id);
  }
}
