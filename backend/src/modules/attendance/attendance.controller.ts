import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import {
  ClockInDto,
  ClockOutDto,
  ApproveOtDto,
  AttendanceQueryDto,
  AttendanceSummaryQueryDto,
  PayableHoursQueryDto,
  ManualAttendanceDto,
} from './dto/attendance.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(private attendanceService: AttendanceService) {}

  /**
   * Clock in for current employee
   * POST /api/attendance/clock-in
   */
  @Post('clock-in')
  async clockIn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClockInDto,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.attendanceService.clockIn(user.tenantId, user.employeeId, dto);
  }

  /**
   * Clock out for current employee
   * POST /api/attendance/clock-out
   */
  @Post('clock-out')
  async clockOut(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClockOutDto,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.attendanceService.clockOut(user.tenantId, user.employeeId, dto);
  }

  /**
   * Get today's attendance status for current employee
   * GET /api/attendance/today
   */
  @Get('today')
  async getTodayStatus(@CurrentUser() user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.attendanceService.getTodayStatus(user.tenantId, user.employeeId);
  }

  /**
   * Get my attendance records
   * GET /api/attendance/me
   */
  @Get('me')
  async getMyAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AttendanceQueryDto,
  ) {
    if (!user.employeeId) {
      throw new Error('User is not linked to an employee');
    }
    return this.attendanceService.getMyAttendance(user.tenantId, user.employeeId, query);
  }

  /**
   * Get attendance summary
   * GET /api/attendance/summary
   */
  @Get('summary')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getAttendanceSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AttendanceSummaryQueryDto,
  ) {
    return this.attendanceService.getAttendanceSummary(user.tenantId, query);
  }

  /**
   * Create manual attendance entry
   * POST /api/attendance/manual
   */
  @Post('manual')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async createManualAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ManualAttendanceDto,
  ) {
    return this.attendanceService.createManualAttendance(user.tenantId, dto);
  }

  /**
   * Get attendance for a specific employee
   * GET /api/attendance/:employeeId
   */
  @Get(':employeeId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getEmployeeAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query() query: AttendanceQueryDto,
  ) {
    return this.attendanceService.getEmployeeAttendance(user.tenantId, employeeId, query);
  }

  /**
   * Get payable hours for an employee
   * GET /api/attendance/:employeeId/payable
   */
  @Get(':employeeId/payable')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getPayableHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query() query: PayableHoursQueryDto,
  ) {
    return this.attendanceService.getPayableHours(user.tenantId, employeeId, query);
  }

  /**
   * Approve OT for an attendance record
   * POST /api/attendance/:id/approve-ot
   */
  @Post(':id/approve-ot')
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async approveOt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveOtDto,
  ) {
    return this.attendanceService.approveOt(user.tenantId, id, dto);
  }
}
