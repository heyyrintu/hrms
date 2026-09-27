import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { JobOpeningsService } from './job-openings.service';

/**
 * Job openings. MANAGER: openings they manage (read); HR/SUPER: all.
 * Scaffold shell (Keka wave D) — WS-D1 adds the routes:
 *   GET|POST /recruitment/openings
 *   GET|PATCH /recruitment/openings/:id
 *   POST /recruitment/openings/:id/publish | /hold | /close
 *   GET /recruitment/openings/:id/applications
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/openings')
export class JobOpeningsController {
  constructor(private readonly service: JobOpeningsService) {}
}
