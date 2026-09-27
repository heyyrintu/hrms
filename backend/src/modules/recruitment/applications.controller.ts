import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApplicationsService } from './applications.service';

/**
 * Applications. MANAGER: applications of openings they manage.
 * Scaffold shell (Keka wave D) — WS-D1 adds the routes:
 *   POST /recruitment/applications (HR)
 *   GET /recruitment/applications/:id
 *   POST /recruitment/applications/:id/move | /reject | /withdraw (withdraw HR)
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/applications')
export class ApplicationsController {
  constructor(private readonly service: ApplicationsService) {}
}
