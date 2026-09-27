import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RecruitmentReportsService } from './recruitment-reports.service';

/**
 * Hiring reports. MANAGER only for openings they manage.
 * Scaffold shell (Keka wave D) — WS-D3 adds the routes:
 *   GET /recruitment/reports/funnel
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/reports')
export class RecruitmentReportsController {
  constructor(private readonly service: RecruitmentReportsService) {}
}
