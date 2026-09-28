import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Response } from 'express';
import { SsoProvider } from '@prisma/client';
import { SsoService } from './sso.service';
import { SsoProviderParamPipe } from './provider-param.pipe';
import { SsoExchangeDto } from './dto/sso-exchange.dto';

/**
 * /auth/sso/* — public SSO routes. Owned by WS-3 (plan Tasks 3.3–3.5).
 * `start` and `callback` always redirect (never a JSON error body), so the
 * browser never sees anything but a 302 from this controller.
 */
@ApiTags('auth')
@Controller('auth/sso')
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  @Get('providers')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Enabled SSO providers for a tenant, and whether it requires SSO' })
  @ApiResponse({ status: 200, description: 'Success' })
  async providers(@Query('org') org?: string) {
    return this.sso.providers(org);
  }

  @Get(':provider/start')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start the OIDC authorisation-code flow with the given provider' })
  @ApiResponse({ status: 302, description: 'Redirect to the identity provider, or to a login error' })
  async start(
    @Param('provider', SsoProviderParamPipe) provider: SsoProvider,
    @Query('org') org: string | undefined,
    @Res() res: Response,
  ) {
    const url = await this.sso.start(provider, org);
    res.redirect(302, url);
  }

  @Get(':provider/callback')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'OIDC redirect target; always redirects on to the frontend' })
  @ApiResponse({ status: 302, description: 'Redirect to /sso/callback#code=... or a login error' })
  async callback(
    @Param('provider', SsoProviderParamPipe) provider: SsoProvider,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const url = await this.sso.callback(provider, query);
    res.redirect(302, url);
  }

  @Post('exchange')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Trade a single-use SSO exchange code for a session' })
  @ApiResponse({ status: 201, description: 'Session issued' })
  @ApiResponse({ status: 401, description: 'Code is invalid, used or expired' })
  async exchange(@Body() dto: SsoExchangeDto) {
    return this.sso.exchange(dto.code);
  }
}
