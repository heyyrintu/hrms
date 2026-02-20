import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsNumber,
  IsDateString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SeparationType } from '@prisma/client';

export class InitiateSeparationDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  employeeId: string;

  @ApiProperty({ enum: SeparationType })
  @IsEnum(SeparationType)
  type: SeparationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'Last working date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  lastWorkingDate?: string;

  @ApiPropertyOptional({ description: 'Notice period in days' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  noticePeriodDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isNoticePeriodWaived?: boolean;
}

export class UpdateSeparationDto {
  @ApiPropertyOptional({ enum: SeparationType })
  @IsOptional()
  @IsEnum(SeparationType)
  type?: SeparationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  lastWorkingDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  noticePeriodDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isNoticePeriodWaived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  exitInterviewDone?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  exitInterviewNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  clearanceNotes?: string;
}

export class SeparationQueryDto {
  @ApiPropertyOptional({ enum: ['INITIATED', 'NOTICE_PERIOD', 'CLEARANCE_PENDING', 'COMPLETED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ enum: SeparationType })
  @IsOptional()
  @IsString()
  type?: string;
}
