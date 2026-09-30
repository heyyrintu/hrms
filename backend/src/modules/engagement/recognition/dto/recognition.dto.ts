import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { LeaderboardPeriod } from '../../engagement-time';

/** Give recognition to 1-10 active employees, with an optional badge and points. */
export class GiveRecognitionDto {
  @ApiProperty({ type: [String], description: '1-10 distinct active employee ids' })
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  recipientIds: string[];

  @ApiProperty({ description: 'The recognition message', minLength: 1, maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  message: string;

  @ApiPropertyOptional({ description: 'An active badge to attach' })
  @IsOptional()
  @IsUUID()
  badgeId?: string;

  @ApiPropertyOptional({
    description: 'Points per recipient. Only used when points are enabled; otherwise ignored.',
    minimum: 0,
    maximum: 1000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  points?: number;
}

export class CreateBadgeDto {
  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'An emoji', minLength: 1, maxLength: 8 })
  @IsString()
  @MinLength(1)
  @MaxLength(8)
  icon: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  points?: number;
}

export class UpdateBadgeDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'An emoji', minLength: 1, maxLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8)
  icon?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  points?: number;

  @ApiPropertyOptional({ description: 'Set true to reactivate a deactivated badge' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BadgesQueryDto {
  @ApiPropertyOptional({ description: 'HR/SUPER only: include inactive badges' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeInactive?: boolean;
}

export class WallQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Only recognitions received by this employee' })
  @IsOptional()
  @IsString()
  employeeId?: string;
}

export class LeaderboardQueryDto {
  @ApiPropertyOptional({ enum: ['month', 'quarter', 'year', 'all'], default: 'month' })
  @IsOptional()
  @IsIn(['month', 'quarter', 'year', 'all'])
  period?: LeaderboardPeriod = 'month';
}
