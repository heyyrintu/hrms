import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequisitionsService } from './requisitions.service';

/**
 * Job requisitions. MANAGER: own requisitions; HR/SUPER: all.
 * Scaffold shell (Keka wave D) — WS-D1 adds the routes:
 *   GET|POST /recruitment/requisitions
 *   GET|PATCH /recruitment/requisitions/:id
 *   POST /recruitment/requisitions/:id/submit | /cancel
 *   (approve / reject: POST /approvals/JOB_REQUISITION/:id/approve|reject)
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN, UserRole.MANAGER)
@Controller('recruitment/requisitions')
export class RequisitionsController {
  constructor(private readonly service: RequisitionsService) {}
}
