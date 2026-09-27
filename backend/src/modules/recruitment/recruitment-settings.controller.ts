import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RecruitmentSettingsService } from './recruitment-settings.service';

/**
 * Hiring settings (HR/SUPER).
 * Scaffold shell (Keka wave D) — WS-D3 adds the routes:
 *   GET|PUT /recruitment/settings
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@Controller('recruitment/settings')
export class RecruitmentSettingsController {
  constructor(private readonly service: RecruitmentSettingsService) {}
}
