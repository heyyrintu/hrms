import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
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
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
  constructor(
    private attendanceService: AttendanceService,
    private prisma: PrismaService,
  ) {}

  /**
   * Clock in for current employee
   * POST /api/attendance/clock-in
   */
  @Post('clock-in')
  @ApiOperation({ summary: 'Clock in for employee' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async clockIn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClockInDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.attendanceService.clockIn(user.tenantId, user.employeeId, dto);
  }

  /**
   * Clock out for current employee
   * POST /api/attendance/clock-out
   */
  @Post('clock-out')
  @ApiOperation({ summary: 'Clock out for employee' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async clockOut(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClockOutDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.attendanceService.clockOut(user.tenantId, user.employeeId, dto);
  }

  /**
   * Get today's attendance status for current employee
   * GET /api/attendance/today
   */
  @Get('today')
  @ApiOperation({ summary: 'Get today attendance status' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTodayStatus(@CurrentUser() user: AuthenticatedUser) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.attendanceService.getTodayStatus(user.tenantId, user.employeeId);
  }

  /**
   * Get my attendance records
   * GET /api/attendance/me
   */
  @Get('me')
  @ApiOperation({ summary: 'Get my attendance records' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMyAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AttendanceQueryDto,
  ) {
    if (!user.employeeId) {
      throw new BadRequestException('User is not linked to an employee');
    }
    return this.attendanceService.getMyAttendance(user.tenantId, user.employeeId, query);
  }

  /**
   * Get attendance summary
   * GET /api/attendance/summary
   */
  @Get('summary')
  @ApiOperation({ summary: 'Get attendance summary' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
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
  @ApiOperation({ summary: 'Create manual attendance entry' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
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
  @ApiOperation({ summary: 'Get employee attendance records' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getEmployeeAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query() query: AttendanceQueryDto,
  ) {
    // Authorization check: Managers can only view their direct reports' attendance
    if (user.role === UserRole.MANAGER) {
      // Allow viewing own attendance or direct reports only
      if (employeeId !== user.employeeId) {
        const employee = await this.prisma.employee.findFirst({
          where: {
            id: employeeId,
            tenantId: user.tenantId,
            managerId: user.employeeId,
          },
        });

        if (!employee) {
          throw new ForbiddenException(
            'You can only view attendance for your direct reports',
          );
        }
      }
    }
    // SUPER_ADMIN and HR_ADMIN can view any employee's attendance

    return this.attendanceService.getEmployeeAttendance(user.tenantId, employeeId, query);
  }

  /**
   * Get payable hours for an employee
   * GET /api/attendance/:employeeId/payable
   */
  @Get(':employeeId/payable')
  @ApiOperation({ summary: 'Get employee payable hours' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getPayableHours(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query() query: PayableHoursQueryDto,
  ) {
    // Authorization check: Managers can only view their direct reports' payable hours
    if (user.role === UserRole.MANAGER) {
      // Allow viewing own data or direct reports only
      if (employeeId !== user.employeeId) {
        const employee = await this.prisma.employee.findFirst({
          where: {
            id: employeeId,
            tenantId: user.tenantId,
            managerId: user.employeeId,
          },
        });

        if (!employee) {
          throw new ForbiddenException(
            'You can only view payable hours for your direct reports',
          );
        }
      }
    }
    // SUPER_ADMIN and HR_ADMIN can view any employee's payable hours

    return this.attendanceService.getPayableHours(user.tenantId, employeeId, query);
  }

  /**
   * Get pending OT approvals
   * GET /api/attendance/pending-ot-approvals
   */
  @Get('pending-ot-approvals')
  @ApiOperation({ summary: 'Get pending OT approvals' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async getPendingOtApprovals(@CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getPendingOtApprovals(user);
  }

  /**
   * Approve OT for an attendance record
   * POST /api/attendance/:id/approve-ot
   */
  @Post(':id/approve-ot')
  @ApiOperation({ summary: 'Approve overtime for attendance' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @ApiResponse({ status: 404, description: 'Not found' })
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
  async approveOt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveOtDto,
  ) {
    return this.attendanceService.approveOt(user.tenantId, id, dto);
  }
}
