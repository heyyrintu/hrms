import { Body, Controller, Get, Param, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PreOnboardingService } from './pre-onboarding.service';
import { PreOnboardingDetailsDto } from './dto/pre-onboarding.dto';
import { PUBLIC_UPLOAD_LIMITS } from './upload-guards';

/**
 * PUBLIC, no auth. Token-based pre-onboarding portal for a future joiner.
 */
@ApiTags('public')
@Controller('public/pre-onboarding')
export class PublicPreOnboardingController {
  constructor(private readonly service: PreOnboardingService) {}

  @Get(':token')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Get the pre-onboarding checklist for a token' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Invalid or expired link' })
  get(@Param('token') token: string) {
    return this.service.getPublic(token);
  }

  @Put(':token/details')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Save personal details' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Locked after submission' })
  @ApiResponse({ status: 404, description: 'Invalid or expired link' })
  saveDetails(@Param('token') token: string, @Body() dto: PreOnboardingDetailsDto) {
    return this.service.saveDetailsPublic(token, dto);
  }

  @Post(':token/documents/:documentKey')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Upload a checklist document' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Invalid document or locked after submission' })
  @ApiResponse({ status: 413, description: 'Document larger than 5 MB' })
  @ApiResponse({ status: 404, description: 'Invalid or expired link' })
  @UseInterceptors(FileInterceptor('file', { limits: PUBLIC_UPLOAD_LIMITS }))
  uploadDocument(
    @Param('token') token: string,
    @Param('documentKey') documentKey: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadDocumentPublic(token, documentKey, file);
  }

  @Post(':token/submit')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit the pre-onboarding checklist' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: 'Required documents missing, or already submitted' })
  @ApiResponse({ status: 404, description: 'Invalid or expired link' })
  submit(@Param('token') token: string) {
    return this.service.submitPublic(token);
  }
}
