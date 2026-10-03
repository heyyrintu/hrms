import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/permissions/require-permissions.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import {
  ApplyRosterDto,
  MyRosterQueryDto,
  RosterGridQueryDto,
  RotationPatternDto,
  UpdateRosterCellsDto,
} from './dto/roster.dto';
import { RotationPatternsService } from './rotation-patterns.service';
import { RosterService } from './roster.service';

/**
 * Shift roster (Keka wave G, WS-R). Its own top-level prefix: `GET
 * /attendance/:employeeId` would swallow a nested path.
 *
 * Write routes and the team grid carry @Roles + @RequirePermissions per
 * method; `GET /roster/me` is open to any signed-in employee.
 */
@ApiTags('roster')
@ApiBearerAuth()
@Controller('roster')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RosterController {
  constructor(
    private readonly patterns: RotationPatternsService,
    private readonly roster: RosterService,
  ) {}

  @Get('patterns')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('attendance.roster.manage')
  @ApiOperation({ summary: 'List active rotation patterns' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listPatterns(@CurrentUser() user: AuthenticatedUser) {
    return this.patterns.list(user.tenantId);
  }

  @Post('patterns')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('attendance.roster.manage')
  @ApiOperation({ summary: 'Create a rotation pattern' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  createPattern(@CurrentUser() user: AuthenticatedUser, @Body() dto: RotationPatternDto) {
    return this.patterns.create(user, dto);
  }

  @Put('patterns/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('attendance.roster.manage')
  @ApiOperation({ summary: 'Replace a rotation pattern and its days' })
  @ApiResponse({ status: 200, description: 'Updated' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  updatePattern(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RotationPatternDto,
  ) {
    return this.patterns.update(user.tenantId, id, dto);
  }

  @Delete('patterns/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('attendance.roster.manage')
  @ApiOperation({ summary: 'Deactivate a rotation pattern' })
  @ApiResponse({ status: 200, description: 'Deactivated' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  removePattern(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.patterns.remove(user.tenantId, id);
  }

  @Post('apply')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('attendance.roster.manage')
  @ApiOperation({ summary: 'Apply a rotation pattern to employees over a date range' })
  @ApiResponse({ status: 201, description: '{ created, updated, skippedManual }' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Pattern not found' })
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyRosterDto) {
    return this.roster.apply(user, dto);
  }

  @Put('cells')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  @RequirePermissions('attendance.roster.manage')
  @ApiOperation({ summary: 'Edit roster cells by hand (up to 1000)' })
  @ApiResponse({ status: 200, description: 'The updated cells, grouped by employee' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  updateCells(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateRosterCellsDto) {
    return this.roster.updateCells(user, dto.cells);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  @RequirePermissions('attendance.roster.manage')
  @ApiOperation({ summary: 'Team roster grid (managers see direct reports only)' })
  @ApiResponse({ status: 200, description: '{ days, rows }' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getGrid(@CurrentUser() user: AuthenticatedUser, @Query() query: RosterGridQueryDto) {
    return this.roster.getGrid(user, query);
  }

  @Get('me')
  @ApiOperation({ summary: 'My own shifts for a date range' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  getMine(@CurrentUser() user: AuthenticatedUser, @Query() query: MyRosterQueryDto) {
    return this.roster.getMine(user, query);
  }
}
