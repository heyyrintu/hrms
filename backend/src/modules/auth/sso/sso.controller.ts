import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SsoService } from './sso.service';

/**
 * /auth/sso/* — public SSO routes. Added by WS-3 (plan Tasks 3.3–3.5).
 */
@ApiTags('auth')
@Controller('auth/sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}
}
