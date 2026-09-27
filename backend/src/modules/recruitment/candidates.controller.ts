import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CandidatesService } from './candidates.service';

/**
 * Candidates (HR/SUPER).
 * Scaffold shell (Keka wave D) — WS-D1 adds the routes:
 *   GET|POST /recruitment/candidates
 *   GET|PATCH /recruitment/candidates/:id
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@Controller('recruitment/candidates')
export class CandidatesController {
  constructor(private readonly service: CandidatesService) {}
}
