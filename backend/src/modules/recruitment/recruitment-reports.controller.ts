import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { RecruitmentReportsService } from './recruitment-reports.service';
import { FunnelQueryDto } from './dto/reports.dto';

/**
 * Hiring reports. MANAGER only for openings they manage.
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/reports')
export class RecruitmentReportsController {
  constructor(private readonly service: RecruitmentReportsService) {}

  @Get('funnel')
  @ApiOperation({ summary: 'Hiring funnel report' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'jobOpeningId is required for a manager' })
  @ApiResponse({ status: 403, description: 'Not the hiring manager for this opening' })
  funnel(@CurrentUser() user: AuthenticatedUser, @Query() query: FunnelQueryDto) {
    return this.service.funnel(user, query);
  }
}
