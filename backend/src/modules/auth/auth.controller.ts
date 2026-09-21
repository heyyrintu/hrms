import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { UserRole } from '@prisma/client';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private passwordResetService: PasswordResetService,
  ) {}

  /**
   * Register a new user (admin only)
   * POST /api/auth/register
   * NOTE: Initial tenant setup should be done via database seeding
   */
  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
  async register(
    @Body() dto: RegisterDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.authService.register(dto, user);
  }

  /**
   * Login with email and password
   * POST /api/auth/login
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change your own password',
    description:
      'Verifies the current password, stores the new one, clears any forced-change flag, and signs out every other session.',
  })
  @ApiResponse({ status: 201, description: 'Password changed' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, dto);
  }

  @Post('login')
  // Brute-force protection: 5 attempts per minute per IP.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Login with credentials' })
  @ApiResponse({ status: 201, description: 'Created' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Start a password reset.
   * POST /api/auth/forgot-password
   *
   * Unauthenticated by design and always 200 with the same body, so it cannot
   * be used to discover which addresses have accounts.
   */
  @Post('forgot-password')
  // Tighter than login: mailing is a side effect an attacker can aim at a victim.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Request a password reset link',
    description:
      'Always succeeds with the same message whether or not the address has an account. ' +
      'A matching active user is emailed a single-use link valid for 60 minutes.',
  })
  @ApiResponse({ status: 201, description: 'Request accepted' })
  @ApiResponse({ status: 429, description: 'Too many reset requests' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordResetService.requestReset(dto);
  }

  /**
   * Complete a password reset with the emailed token.
   * POST /api/auth/reset-password
   */
  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset a password using an emailed token',
    description:
      'Stores the new password, signs out every existing session and burns the token.',
  })
  @ApiResponse({ status: 201, description: 'Password reset' })
  @ApiResponse({ status: 400, description: 'Token is invalid, used or expired' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordResetService.resetPassword(dto);
  }

  /**
   * Get current user profile
   * GET /api/auth/me
   */
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Success' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.userId);
  }
}
