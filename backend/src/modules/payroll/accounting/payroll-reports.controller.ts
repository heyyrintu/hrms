import { Controller, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { VarianceReportService } from './variance-report.service';

/**
 * WS-C2 (Keka wave C) routes, HR_ADMIN / SUPER_ADMIN. Scaffold shell — WS-C2
 * adds: GET /payroll/reports/variance, GET /payroll/reports/variance/export.
 */
@ApiTags('payroll-reports')
@ApiBearerAuth()
@Controller('payroll/reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
export class PayrollReportsController {
  constructor(private readonly variance: VarianceReportService) {}
}
