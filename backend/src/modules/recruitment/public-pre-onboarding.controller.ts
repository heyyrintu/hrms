import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PreOnboardingService } from './pre-onboarding.service';

/**
 * PUBLIC, no auth. ThrottlerGuard + @Throttle per route.
 * Scaffold shell (Keka wave D) — WS-D3 adds the routes:
 *   GET /public/pre-onboarding/:token
 *   PUT /public/pre-onboarding/:token/details
 *   POST /public/pre-onboarding/:token/documents/:documentKey (multipart)
 *   POST /public/pre-onboarding/:token/submit
 */
@ApiTags('public')
@Controller('public/pre-onboarding')
export class PublicPreOnboardingController {
  constructor(private readonly service: PreOnboardingService) {}
}
