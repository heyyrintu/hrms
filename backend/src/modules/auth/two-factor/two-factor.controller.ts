import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { TwoFactorService } from './two-factor.service';
import { SessionOrEnrolGuard } from './session-or-enrol.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../common/types/jwt-payload.type';
import {
  DisableTwoFactorDto,
  EnableTwoFactorDto,
  RegenerateRecoveryCodesDto,
  VerifyTwoFactorDto,
} from './dto/two-factor.dto';

/**
 * /auth/2fa/* — verify, setup, enable, disable, recovery codes, status.
 * Routes added by WS-2 (plan Task 2.4).
 */
@ApiTags('auth')
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Post('verify')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify a second-factor code for a login that stopped at an MfaChallenge' })
  @ApiResponse({ status: 201, description: 'Session issued' })
  @ApiResponse({ status: 401, description: 'Invalid code' })
  async verify(@Body() dto: VerifyTwoFactorDto) {
    return this.twoFactor.verify(dto.mfaToken, dto.code);
  }

  @Post('setup')
  @UseGuards(SessionOrEnrolGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start (or restart) TOTP enrolment' })
  @ApiResponse({ status: 201, description: 'otpauth URL and QR code' })
  @ApiResponse({ status: 400, description: 'Already enabled' })
  async setup(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.setup(user);
  }

  @Post('enable')
  @UseGuards(SessionOrEnrolGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm the pending secret and turn 2FA on' })
  @ApiResponse({ status: 201, description: 'Recovery codes and a fresh session' })
  @ApiResponse({ status: 400, description: 'No pending secret' })
  @ApiResponse({ status: 401, description: 'Invalid code' })
  async enable(@CurrentUser() user: AuthenticatedUser, @Body() dto: EnableTwoFactorDto) {
    return this.twoFactor.enable(user, dto.code);
  }

  @Post('disable')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Turn 2FA off' })
  @ApiResponse({ status: 201, description: 'A fresh session' })
  @ApiResponse({ status: 403, description: 'The role requires 2FA' })
  async disable(@CurrentUser() user: AuthenticatedUser, @Body() dto: DisableTwoFactorDto) {
    return this.twoFactor.disable(user, dto.password, dto.code);
  }

  @Post('recovery-codes')
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace every recovery code' })
  @ApiResponse({ status: 201, description: 'The new recovery codes' })
  async regenerateRecoveryCodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegenerateRecoveryCodesDto,
  ) {
    return this.twoFactor.regenerateRecoveryCodes(user, dto.code);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current 2FA status for the signed-in user' })
  async status(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.status(user);
  }
}
