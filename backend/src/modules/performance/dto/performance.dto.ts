import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsNumber,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ============================================
// Review Cycles
// ============================================

export class CreateReviewCycleDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  @IsDateString()
  endDate: string;
}

export class UpdateReviewCycleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class ReviewCycleQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'ACTIVE', 'COMPLETED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ default: '20' })
  @IsOptional()
  @IsString()
  limit?: string;
}

// ============================================
// Reviews
// ============================================

export class SubmitSelfReviewDto {
  @ApiProperty({ description: 'Rating 1-5' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  selfRating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  selfComments?: string;
}

export class SubmitManagerReviewDto {
  @ApiProperty({ description: 'Rating 1-5' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  managerRating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  managerComments?: string;

  @ApiProperty({ description: 'Overall rating 1-5' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  overallRating: number;
}

export class ReviewQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'SELF_REVIEW', 'MANAGER_REVIEW', 'COMPLETED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cycleId?: string;

  @ApiPropertyOptional({ default: '1' })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({ default: '20' })
  @IsOptional()
  @IsString()
  limit?: string;
}

// ============================================
// Goals
// ============================================

export class CreateGoalDto {
  @ApiProperty()
  @IsUUID()
  reviewId: string;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  @IsDateString()
  targetDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  weight?: number;
}

export class UpdateGoalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({ enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  weight?: number;
}
