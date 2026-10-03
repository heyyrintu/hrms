import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { AttendanceRequestsService } from './attendance-requests.service';
import {
  AllAttendanceRequestsQueryDto,
  AttendanceRequestDecisionDto,
  CreateAttendanceRequestDto,
  MyAttendanceRequestsQueryDto,
} from './dto/attendance-request.dto';

/** WFH and on-duty requests (Keka wave G, WS-A). */
@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceRequestsController {
  constructor(private readonly requests: AttendanceRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Request work from home or on duty' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAttendanceRequestDto) {
    return this.requests.create(user, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'My WFH / on-duty requests' })
  listMine(@CurrentUser() user: AuthenticatedUser, @Query() q: MyAttendanceRequestsQueryDto) {
    return this.requests.listMine(user, q);
  }

  @Get('pending-approvals')
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Requests awaiting my approval' })
  pendingApprovals(@CurrentUser() user: AuthenticatedUser) {
    return this.requests.listPendingApprovals(user);
  }

  @Get('all')
  @Roles(UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'All requests (admin view, paginated)' })
  listAll(@CurrentUser() user: AuthenticatedUser, @Query() q: AllAttendanceRequestsQueryDto) {
    return this.requests.listAll(user.tenantId, q);
  }

  @Post(':id/approve')
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Approve a request (the approval engine decides eligibility)' })
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttendanceRequestDecisionDto,
  ) {
    return this.requests.approve(user, id, dto.note);
  }

  @Post(':id/reject')
  @Roles(UserRole.MANAGER, UserRole.HR_ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Reject a request' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AttendanceRequestDecisionDto,
  ) {
    return this.requests.reject(user, id, dto.note);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel my request (future days only once approved)' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.requests.cancel(user, id);
  }
}
