import { Controller, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { InterviewsService } from './interviews.service';

/**
 * Interviews and feedback. Class is open to every role; route-level @Roles narrow it.
 * Scaffold shell (Keka wave D) — WS-D2 adds the routes:
 *   GET|POST /recruitment/applications/:id/interviews (M)
 *   PATCH /recruitment/interviews/:id (M)
 *   POST /recruitment/interviews/:id/cancel | /complete | /no-show (M)
 *   GET /recruitment/interviews/mine (any)
 *   GET|POST /recruitment/interviews/:id/feedback (panelist / M)
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('recruitment')
export class InterviewsController {
  constructor(private readonly service: InterviewsService) {}
}
