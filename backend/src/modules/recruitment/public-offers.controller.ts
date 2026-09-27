import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { OffersService, PublicAnswerMeta } from './offers.service';
import { AcceptOfferDto, DeclineOfferDto } from './dto/offer.dto';
import { PublicOfferView } from './recruitment.types';

function answerMeta(req: Request): PublicAnswerMeta {
  const ua = req.headers?.['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua : null,
  };
}

/**
 * PUBLIC, no auth (there is no global guard): the candidate answers an offer
 * through the token in their e-mail. The token is the only key; it maps to
 * exactly one offer and the view carries only that offer's letter. Unknown,
 * malformed and expired tokens answer the same 404.
 */
@ApiTags('public')
@UseGuards(ThrottlerGuard)
@Controller('public/offers')
export class PublicOffersController {
  constructor(private readonly service: OffersService) {}

  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'View an offer by its link token' })
  @ApiResponse({ status: 404, description: 'This offer link is invalid or has expired' })
  get(@Param('token') token: string): Promise<PublicOfferView> {
    return this.service.getPublic(token);
  }

  @Post(':token/accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Accept the offer by typing your full name' })
  @ApiResponse({ status: 400, description: 'Name mismatch, or the offer can no longer be answered' })
  @ApiResponse({ status: 409, description: 'Already answered' })
  accept(
    @Param('token') token: string,
    @Body() dto: AcceptOfferDto,
    @Req() req: Request,
  ): Promise<PublicOfferView> {
    return this.service.acceptPublic(token, dto, answerMeta(req));
  }

  @Post(':token/decline')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Decline the offer' })
  decline(
    @Param('token') token: string,
    @Body() dto: DeclineOfferDto,
    @Req() req: Request,
  ): Promise<PublicOfferView> {
    return this.service.declinePublic(token, dto, answerMeta(req));
  }
}
