import { Body, Controller, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PublicCareersService } from './public-careers.service';
import { CareersApplyDto } from './dto/careers.dto';

/**
 * PUBLIC, no auth. Careers page per tenant and public apply.
 */
@ApiTags('public')
@Controller('public/careers')
export class PublicCareersController {
  constructor(private readonly service: PublicCareersService) {}

  @Get(':tenantCode')
  @ApiOperation({ summary: 'Public careers page' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Careers page not found' })
  getCareers(@Param('tenantCode') tenantCode: string) {
    return this.service.getCareers(tenantCode);
  }

  @Get(':tenantCode/jobs/:slug')
  @ApiOperation({ summary: 'Public job listing' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: 'Careers page not found' })
  getJob(@Param('tenantCode') tenantCode: string, @Param('slug') slug: string) {
    return this.service.getJob(tenantCode, slug);
  }

  @Post(':tenantCode/jobs/:slug/apply')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        resume: { type: 'string', format: 'binary' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Apply to a job opening' })
  @ApiResponse({ status: 201 })
  @ApiResponse({ status: 400, description: 'Invalid resume file' })
  @ApiResponse({ status: 404, description: 'Careers page not found' })
  @ApiResponse({ status: 429, description: 'Too many applications' })
  @UseInterceptors(FileInterceptor('resume'))
  apply(
    @Param('tenantCode') tenantCode: string,
    @Param('slug') slug: string,
    @Body() dto: CareersApplyDto,
    @UploadedFile() resume: Express.Multer.File,
  ) {
    return this.service.apply(tenantCode, slug, dto, resume);
  }
}
