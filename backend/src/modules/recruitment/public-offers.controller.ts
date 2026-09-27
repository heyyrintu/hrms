import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OffersService } from './offers.service';

/**
 * PUBLIC, no auth (there is no global guard). ThrottlerGuard + @Throttle per route.
 * Scaffold shell (Keka wave D) — WS-D2 adds the routes:
 *   GET /public/offers/:token (20/min)
 *   POST /public/offers/:token/accept | /decline (5/min)
 */
@ApiTags('public')
@Controller('public/offers')
export class PublicOffersController {
  constructor(private readonly service: OffersService) {}
}
