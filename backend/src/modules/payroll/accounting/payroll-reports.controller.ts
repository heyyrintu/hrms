import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import { VarianceReportService } from './variance-report.service';
import { VarianceQueryDto } from './dto/accounting.dto';

/**
 * WS-C2 (Keka wave C) routes, HR_ADMIN / SUPER_ADMIN.
 */
@ApiTags('payroll-reports')
@ApiBearerAuth()
@Controller('payroll/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class PayrollReportsController {
  constructor(private readonly variance: VarianceReportService) {}

  @Get('variance')
  @ApiOperation({ summary: 'Compare a payroll run against a previous one, per employee and per component' })
  getVariance(@CurrentUser() user: AuthenticatedUser, @Query() query: VarianceQueryDto) {
    return this.variance.build(user.tenantId, query);
  }

  @Get('variance/export')
  @ApiOperation({ summary: 'Download the variance report as CSV' })
  async exportVariance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: VarianceQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.variance.exportCsv(user.tenantId, query);
    res.setHeader('Content-Type', `${file.contentType}; charset=utf-8`);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.content;
  }
}
