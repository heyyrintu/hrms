import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PreOnboardingService } from './pre-onboarding.service';

/**
 * Pre-onboarding invites, HR side (HR/SUPER).
 * Scaffold shell (Keka wave D) — WS-D3 adds the routes:
 *   GET|POST /recruitment/pre-onboarding
 *   GET /recruitment/pre-onboarding/:id
 *   POST /recruitment/pre-onboarding/:id/revoke | /resend | /complete
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@Controller('recruitment/pre-onboarding')
export class PreOnboardingController {
  constructor(private readonly service: PreOnboardingService) {}
}
