import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OffersService } from './offers.service';

/**
 * Offers (HR/SUPER).
 * Scaffold shell (Keka wave D) — WS-D2 adds the routes:
 *   GET /recruitment/offers
 *   POST /recruitment/applications/:id/offers
 *   GET|PATCH /recruitment/offers/:id
 *   POST /recruitment/offers/:id/submit | /send | /withdraw | /convert
 *   GET /recruitment/offers/:id/pdf
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@Controller('recruitment')
export class OffersController {
  constructor(private readonly service: OffersService) {}
}
