import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  IsBoolean,
  IsArray,
  IsUUID,
  Min,
  Max,
  MaxLength,
  ValidateNested,
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

  @ApiPropertyOptional({ description: 'Review template to snapshot at launch', nullable: true })
  @IsOptional()
  @IsUUID()
  templateId?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  peerFeedbackEnabled?: boolean;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxPeers?: number;
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

  @ApiPropertyOptional({ description: 'Review template to snapshot at launch (null clears it)', nullable: true })
  @IsOptional()
  @IsUUID()
  templateId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  peerFeedbackEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 1, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxPeers?: number;
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

export class AnswerInputDto {
  @ApiProperty({ description: 'Id of a ReviewCycleQuestion of the cycle' })
  @IsUUID()
  cycleQuestionId: string;

  @ApiPropertyOptional({ description: 'RATING questions: whole number 1-5' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ description: 'TEXT questions: 1-5000 chars after trimming' })
  @IsOptional()
  @IsString()
  @MaxLength(6000)
  text?: string;
}

export class CompetencyRatingInputDto {
  @ApiProperty({ description: 'Id of the review competency rating row' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'Rating 1-5' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

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

  @ApiPropertyOptional({ type: [AnswerInputDto], description: 'Answers to the SELF questions of the cycle' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerInputDto)
  answers?: AnswerInputDto[];
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

  @ApiPropertyOptional({ description: 'Potential 1-3 (feeds the 9-box)', minimum: 1, maximum: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  potentialRating?: number;

  @ApiPropertyOptional({ type: [AnswerInputDto], description: 'Answers to the MANAGER questions of the cycle' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerInputDto)
  answers?: AnswerInputDto[];

  @ApiPropertyOptional({
    type: [CompetencyRatingInputDto],
    description: 'Must cover exactly the competency rows of the review when it has any',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompetencyRatingInputDto)
  competencyRatings?: CompetencyRatingInputDto[];
}

export class SetPotentialDto {
  @ApiProperty({ description: 'Potential 1-3', minimum: 1, maximum: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  potentialRating: number;
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
