import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { LeaveService } from './leave.service';
import {
  CreateLeaveRequestDto,
  ApproveLeaveDto,
  RejectLeaveDto,
  LeaveRequestQueryDto,
  LeaveBalanceQueryDto,
  CreateLeaveTypeDto,
  UpdateLeaveBalanceDto,
  AdminLeaveRequestQueryDto,
  InitializeBalancesDto,
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
  constructor(private leaveService: LeaveService) { }

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
      throw new BadRequestException('User is not linked to an employee');
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
      throw new BadRequestException('User is not linked to an employee');
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
      throw new BadRequestException('User is not linked to an employee');
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
      throw new BadRequestException('User is not linked to an employee');
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
      throw new BadRequestException('User is not linked to an employee');
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
      throw new BadRequestException('User is not linked to an employee');
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
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.leaveService.rejectRequest(user.tenantId, id, user.employeeId, dto);
  }

  // ==========================================
  // ADMIN ENDPOINTS
  // ==========================================

  /**
   * Create a leave type (Admin)
   * POST /api/leave/admin/types
   */
  @Post('admin/types')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async createLeaveType(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLeaveTypeDto,
  ) {
    return this.leaveService.createLeaveType(user.tenantId, dto);
  }

  /**
   * Update a leave type (Admin)
   * PUT /api/leave/admin/types/:id
   */
  @Put('admin/types/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async updateLeaveType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateLeaveTypeDto,
  ) {
    return this.leaveService.updateLeaveType(user.tenantId, id, dto);
  }

  /**
   * Delete a leave type (Admin)
   * DELETE /api/leave/admin/types/:id
   */
  @Delete('admin/types/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async deleteLeaveType(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.leaveService.deleteLeaveType(user.tenantId, id);
  }

  /**
   * Get all employee balances (Admin)
   * GET /api/leave/admin/balances
   */
  @Get('admin/balances')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getAllBalances(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LeaveBalanceQueryDto,
  ) {
    return this.leaveService.getAllBalances(user.tenantId, query.year);
  }

  /**
   * Get employee balance (Admin)
   * GET /api/leave/admin/balances/:employeeId
   */
  @Get('admin/balances/:employeeId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getEmployeeBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query() query: LeaveBalanceQueryDto,
  ) {
    return this.leaveService.getBalances(user.tenantId, employeeId, query.year);
  }

  /**
   * Update employee balance (Admin)
   * PUT /api/leave/admin/balances/:employeeId/:leaveTypeId
   */
  @Put('admin/balances/:employeeId/:leaveTypeId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async updateEmployeeBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Param('leaveTypeId') leaveTypeId: string,
    @Query('year') year: number,
    @Body() dto: UpdateLeaveBalanceDto,
  ) {
    return this.leaveService.updateBalance(
      user.tenantId,
      employeeId,
      leaveTypeId,
      year || new Date().getFullYear(),
      dto,
    );
  }

  /**
   * Initialize balances for all employees for a year (Admin)
   * POST /api/leave/admin/balances/initialize
   */
  @Post('admin/balances/initialize')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async initializeBalances(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitializeBalancesDto,
  ) {
    return this.leaveService.initializeBalances(user.tenantId, dto);
  }

  /**
   * Get all leave requests (Admin)
   * GET /api/leave/admin/requests
   */
  @Get('admin/requests')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getAllRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminLeaveRequestQueryDto,
  ) {
    return this.leaveService.getAllRequests(user.tenantId, query);
  }

  /**
   * Get leave analytics (Admin)
   * GET /api/leave/admin/analytics
   */
  @Get('admin/analytics')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async getAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query('year') year?: number,
  ) {
    return this.leaveService.getAnalytics(user.tenantId, year);
  }
}
