import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { CompetenciesService } from './competencies.service';
import {
  CreateCompetencyDto,
  SetDesignationCompetenciesDto,
  UpdateCompetencyDto,
} from './dto/competencies.dto';

/** Competency framework (spec F3). Every route is admin-only. */
@ApiTags('performance')
@ApiBearerAuth()
@Controller('performance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompetenciesController {
  constructor(private competenciesService: CompetenciesService) {}

  @Get('competencies')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'List competencies with their mapped-designation count' })
  @ApiResponse({ status: 200, description: 'Success' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.competenciesService.list(user.tenantId);
  }

  @Post('competencies')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Create a competency' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 409, description: 'Name already exists' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompetencyDto) {
    return this.competenciesService.create(user.tenantId, dto);
  }

  @Put('competencies/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Update or deactivate a competency' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @ApiResponse({ status: 409, description: 'Name already exists' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCompetencyDto,
  ) {
    return this.competenciesService.update(user.tenantId, id, dto);
  }

  @Delete('competencies/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Delete a competency that no designation uses' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Mapped to designations' })
  @ApiResponse({ status: 404, description: 'Not found' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.competenciesService.remove(user.tenantId, id);
  }

  @Get('designations/:id/competencies')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Competencies expected of a designation' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Designation not found' })
  async forDesignation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.competenciesService.getForDesignation(user.tenantId, id);
  }

  @Put('designations/:id/competencies')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @ApiOperation({ summary: 'Replace the competencies expected of a designation' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Duplicate, unknown or inactive competency' })
  @ApiResponse({ status: 404, description: 'Designation not found' })
  async setForDesignation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetDesignationCompetenciesDto,
  ) {
    return this.competenciesService.setForDesignation(user.tenantId, id, dto);
  }
}
