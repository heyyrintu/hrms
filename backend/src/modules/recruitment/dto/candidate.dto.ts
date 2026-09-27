import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { CandidateSource } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCandidateDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty()
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
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  totalExperienceYears?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  currentCtc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedCtc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  noticePeriodDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  linkedinUrl?: string;

  @ApiPropertyOptional({ enum: CandidateSource })
  @IsOptional()
  @IsEnum(CandidateSource)
  source?: CandidateSource;

  @ApiPropertyOptional({ description: 'Employee id of the referrer, when source is REFERRAL' })
  @IsOptional()
  @IsUUID()
  referredByEmployeeId?: string;

  @ApiPropertyOptional({ description: 'Upload id from POST /uploads (entityType CANDIDATE_RESUME)' })
  @IsOptional()
  @IsUUID()
  resumeUploadId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class UpdateCandidateDto extends PartialType(CreateCandidateDto) {}
