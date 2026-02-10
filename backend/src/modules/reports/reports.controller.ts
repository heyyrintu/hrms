import {
  Controller,
  Post,
  Body,
  UseGuards,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import {
  AttendanceReportDto,
  LeaveReportDto,
  EmployeeReportDto,
} from './dto/report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Post('attendance')
  @ApiOperation({ summary: 'Generate attendance report' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async attendanceReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AttendanceReportDto,
    @Res() res: Response,
  ) {
    const result = await this.reportsService.generateAttendanceReport(
      user.tenantId,
      dto,
      user.role,
      user.employeeId,
    );
    this.sendFile(res, result);
  }

  @Post('leave')
  @ApiOperation({ summary: 'Generate leave report' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async leaveReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LeaveReportDto,
    @Res() res: Response,
  ) {
    const result = await this.reportsService.generateLeaveReport(
      user.tenantId,
      dto,
      user.role,
      user.employeeId,
    );
    this.sendFile(res, result);
  }

  @Post('employees')
  @ApiOperation({ summary: 'Generate employee report' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async employeeReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: EmployeeReportDto,
    @Res() res: Response,
  ) {
    const result = await this.reportsService.generateEmployeeReport(
      user.tenantId,
      dto,
      user.role,
      user.employeeId,
    );
    this.sendFile(res, result);
  }

  private sendFile(
    res: Response,
    file: { buffer: Buffer; filename: string; contentType: string },
  ) {
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Content-Length': file.buffer.length,
    });
    res.end(file.buffer);
  }
}
