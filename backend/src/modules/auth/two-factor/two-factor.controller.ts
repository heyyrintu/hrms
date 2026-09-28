import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TwoFactorService } from './two-factor.service';

/**
 * /auth/2fa/* — verify, setup, enable, disable, recovery codes, status.
 * Routes are added by WS-2 (plan Task 2.4).
 */
@ApiTags('auth')
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}
}
