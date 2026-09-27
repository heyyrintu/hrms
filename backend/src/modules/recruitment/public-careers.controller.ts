import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublicCareersService } from './public-careers.service';

/**
 * PUBLIC, no auth. ThrottlerGuard + @Throttle per route.
 * Scaffold shell (Keka wave D) — WS-D3 adds the routes:
 *   GET /public/careers/:tenantCode
 *   GET /public/careers/:tenantCode/jobs/:slug
 *   POST /public/careers/:tenantCode/jobs/:slug/apply (multipart, 5/min)
 */
@ApiTags('public')
@Controller('public/careers')
export class PublicCareersController {
  constructor(private readonly service: PublicCareersService) {}
}
