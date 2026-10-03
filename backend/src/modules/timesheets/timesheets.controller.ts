import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { TimesheetsService } from './timesheets.service';
import { parseDateOnly } from './timesheet-week';
import {
  AllTimesheetsQueryDto,
  MyTimesheetsQueryDto,
  MyWeekQueryDto,
  SaveTimesheetEntriesDto,
  TimesheetDecisionDto,
} from './dto/timesheet.dto';

/**
 * Weekly timesheets (Keka wave G, WS-T).
 *
 * Route order matters: every static route (`me`, `me/list`, `pending-approvals`,
 * `all`) is declared before `GET :id`, which would otherwise swallow them.
 */
@ApiTags('timesheets')
@ApiBearerAuth()
@Controller('timesheets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  @Get('me')
  @ApiOperation({ summary: "My timesheet for a week, with attended minutes per day" })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 400, description: 'weekStart is not a Monday, or no employee record' })
  getMyWeek(@CurrentUser() user: AuthenticatedUser, @Query() query: MyWeekQueryDto) {
    return this.timesheets.getMyWeek(user, parseDateOnly(query.weekStart, 'weekStart'));
  }

  @Get('me/list')
  @ApiOperation({ summary: 'My timesheet summaries, newest week first' })
  @ApiResponse({ status: 200, description: 'Success' })
  listMine(@CurrentUser() user: AuthenticatedUser, @Query() query: MyTimesheetsQueryDto) {
    return this.timesheets.listMine(
      user,
      query.from ? parseDateOnly(query.from.slice(0, 10), 'from') : undefined,
      query.to ? parseDateOnly(query.to.slice(0, 10), 'to') : undefined,
    );
  }

  @Put('me/:weekStart/entries')
  @ApiOperation({ summary: "Replace the week's entries (draft)" })
  @ApiResponse({ status: 200, description: 'Saved' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  saveEntries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('weekStart') weekStart: string,
    @Body() dto: SaveTimesheetEntriesDto,
  ) {
    return this.timesheets.saveEntries(user, parseDateOnly(weekStart, 'weekStart'), dto);
  }

  @Get('pending-approvals')
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Timesheets awaiting my approval' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  getPendingApprovals(@CurrentUser() user: AuthenticatedUser) {
    return this.timesheets.listPendingApprovals(user);
  }

  @Get('all')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'All timesheets (admin), paginated' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  listAll(@CurrentUser() user: AuthenticatedUser, @Query() query: AllTimesheetsQueryDto) {
    return this.timesheets.listAll(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One timesheet with entries (owner, HR, manager or approver)' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 404, description: 'Not found or not visible' })
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.timesheets.get(user, id);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit my timesheet for approval' })
  @ApiResponse({ status: 201, description: 'Submitted' })
  @ApiResponse({ status: 400, description: 'Not submittable, or entries no longer valid' })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.timesheets.submit(user, id);
  }

  @Post(':id/recall')
  @ApiOperation({ summary: 'Recall my submitted timesheet to draft' })
  @ApiResponse({ status: 201, description: 'Recalled' })
  @ApiResponse({ status: 400, description: 'Not submitted' })
  recall(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.timesheets.recall(user, id);
  }

  @Post(':id/approve')
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Approve a timesheet (current approval step)' })
  @ApiResponse({ status: 201, description: 'Approved or advanced' })
  @ApiResponse({ status: 403, description: 'Not an approver for this step' })
  @ApiResponse({ status: 409, description: 'Already processed' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TimesheetDecisionDto,
  ) {
    return this.timesheets.approve(user, id, dto.note);
  }

  @Post(':id/reject')
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Reject a timesheet (current approval step)' })
  @ApiResponse({ status: 201, description: 'Rejected' })
  @ApiResponse({ status: 403, description: 'Not an approver for this step' })
  @ApiResponse({ status: 409, description: 'Already processed' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TimesheetDecisionDto,
  ) {
    return this.timesheets.reject(user, id, dto.note);
  }
}
