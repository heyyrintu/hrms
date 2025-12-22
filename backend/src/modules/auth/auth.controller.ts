import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Register a new user (dev mode or tenant bootstrap)
   * POST /api/auth/register
   */
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Login with email and password
   * POST /api/auth/login
   */
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * Get current user profile
   * GET /api/auth/me
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.userId);
  }
}
