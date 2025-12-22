import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { LeaveService } from './leave.service';
import {
  CreateLeaveRequestDto,
  ApproveLeaveDto,
  RejectLeaveDto,
  LeaveRequestQueryDto,
  LeaveBalanceQueryDto,
} from './dto/leave.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

@Controller('leave')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeaveController {
  constructor(private leaveService: LeaveService) {}

  /**
   * Get leave types
   * GET /api/leave/types
   */
  @Get('types')
  async getLeaveTypes(@CurrentUser() user: AuthenticatedUser) {
    return this.leaveService.getLeaveTypes(user.tenantId);
  }

  /**
   * Get my leave balances
   * GET /api/leave/balances/me
   */
  @Get('balances/me')
  async getMyBalances(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LeaveBalanceQueryDto,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.leaveService.getBalances(user.tenantId, user.employeeId, query.year);
  }

  /**
   * Get my leave requests
   * GET /api/leave/requests/me
   */
  @Get('requests/me')
  async getMyRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LeaveRequestQueryDto,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.leaveService.getMyRequests(user.tenantId, user.employeeId, query);
  }

  /**
   * Get pending approvals (for managers)
   * GET /api/leave/requests/pending-approvals
   */
  @Get('requests/pending-approvals')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getPendingApprovals(@CurrentUser() user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.leaveService.getPendingApprovals(user.tenantId, user.employeeId);
  }

  /**
   * Create a leave request
   * POST /api/leave/requests
   */
  @Post('requests')
  async createRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLeaveRequestDto,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.leaveService.createRequest(user.tenantId, user.employeeId, dto);
  }

  /**
   * Cancel a leave request
   * POST /api/leave/requests/:id/cancel
   */
  @Post('requests/:id/cancel')
  async cancelRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.leaveService.cancelRequest(user.tenantId, id, user.employeeId);
  }

  /**
   * Approve a leave request
   * POST /api/leave/requests/:id/approve
   */
  @Post('requests/:id/approve')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async approveRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveLeaveDto,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.leaveService.approveRequest(user.tenantId, id, user.employeeId, dto);
  }

  /**
   * Reject a leave request
   * POST /api/leave/requests/:id/reject
   */
  @Post('requests/:id/reject')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async rejectRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectLeaveDto,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.leaveService.rejectRequest(user.tenantId, id, user.employeeId, dto);
  }
}
