import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/jwt-payload.type';
import { OffersService } from './offers.service';
import { OfferConversionService } from './offer-conversion.service';
import { ConvertOfferDto, CreateOfferDto, ListOffersDto, UpdateOfferDto } from './dto/offer.dto';
import { OfferConversionResult, OfferView } from './recruitment.types';

/**
 * Offers (HR / SUPER_ADMIN). Approve / reject go through the unified
 * `POST /approvals/OFFER/:id/approve|reject` (OfferWorkflowHandler).
 */
@ApiTags('recruitment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.HR_ADMIN)
@Controller('recruitment')
export class OffersController {
  constructor(
    private readonly service: OffersService,
    private readonly conversion: OfferConversionService,
  ) {}

  @Get('offers')
  @ApiOperation({ summary: 'List offers, optionally by status' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListOffersDto): Promise<OfferView[]> {
    return this.service.list(user, query);
  }

  @Post('applications/:id/offers')
  @ApiOperation({ summary: 'Draft an offer from an OFFER_LETTER template' })
  @ApiResponse({ status: 409, description: 'The application already has an open offer' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') applicationId: string,
    @Body() dto: CreateOfferDto,
  ): Promise<OfferView> {
    return this.service.create(user, applicationId, dto);
  }

  @Get('offers/:id')
  @ApiOperation({ summary: 'Get an offer' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OfferView> {
    return this.service.get(user, id);
  }

  @Patch('offers/:id')
  @ApiOperation({ summary: 'Edit a draft or rejected offer (re-renders the letter)' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateOfferDto,
  ): Promise<OfferView> {
    return this.service.update(user, id, dto);
  }

  @Post('offers/:id/submit')
  @ApiOperation({ summary: 'Submit for approval' })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OfferView> {
    return this.service.submit(user, id);
  }

  @Post('offers/:id/send')
  @ApiOperation({ summary: 'E-mail the approved offer to the candidate with an answer link' })
  send(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OfferView> {
    return this.service.send(user, id);
  }

  @Post('offers/:id/withdraw')
  @ApiOperation({ summary: 'Withdraw an offer' })
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<OfferView> {
    return this.service.withdraw(user, id);
  }

  @Post('offers/:id/convert')
  @ApiOperation({ summary: 'Turn an accepted offer into an employee' })
  @ApiResponse({ status: 409, description: 'Already converted, or employee code / email in use' })
  convert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConvertOfferDto,
  ): Promise<OfferConversionResult> {
    return this.conversion.convert(user, id, dto);
  }

  @Get('offers/:id/pdf')
  @ApiOperation({ summary: 'Download the offer letter as PDF' })
  async pdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName } = await this.service.pdf(user, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }
}
