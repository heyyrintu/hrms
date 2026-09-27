import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `POST /public/careers/:tenantCode/jobs/:slug/apply` (multipart form fields;
 * the resume file itself is handled separately by `FileInterceptor`).
 *
 * `website` is a honeypot: a real applicant's browser never fills a field
 * hidden with CSS, so any non-empty value here means a bot filled every
 * field it could see. Kept on the DTO (not silently dropped) so the
 * whitelist-validation pipe doesn't reject the request for an unknown field.
 */
export class CareersApplyDto {
  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @MaxLength(100)
  lastName: string;

  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  currentCompany?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  currentTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(60)
  totalExperienceYears?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  @MaxLength(300)
  linkedinUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  coverLetter?: string;

  /** Honeypot. Must be empty; a non-empty value silently rejects the request. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;
}
