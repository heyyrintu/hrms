import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { InterviewMode, InterviewRecommendation } from '@prisma/client';

export const MAX_PANELISTS = 10;
export const MAX_FEEDBACK_SCORES = 20;

export class ScheduleInterviewDto {
  @ApiProperty({ maxLength: 100, example: 'Technical round 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  roundName: string;

  @ApiProperty({ description: 'ISO date-time' })
  @IsDateString()
  scheduledStart: string;

  @ApiProperty({ description: 'ISO date-time, after scheduledStart' })
  @IsDateString()
  scheduledEnd: string;

  @ApiPropertyOptional({ enum: InterviewMode, default: InterviewMode.VIDEO })
  @IsOptional()
  @IsEnum(InterviewMode)
  mode?: InterviewMode;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingLink?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiProperty({ type: [String], description: '1–10 employee ids' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PANELISTS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  panelEmployeeIds: string[];
}

export class UpdateInterviewDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  roundName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  scheduledEnd?: string;

  @ApiPropertyOptional({ enum: InterviewMode })
  @IsOptional()
  @IsEnum(InterviewMode)
  mode?: InterviewMode;

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingLink?: string | null;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PANELISTS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  panelEmployeeIds?: string[];
}

export class FeedbackScoreDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  criterion: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}

export class SubmitFeedbackDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  overallRating: number;

  @ApiProperty({ enum: InterviewRecommendation })
  @IsEnum(InterviewRecommendation)
  recommendation: InterviewRecommendation;

  @ApiProperty({ type: [FeedbackScoreDto], description: 'At most 20 rows' })
  @IsArray()
  @ArrayMaxSize(MAX_FEEDBACK_SCORES)
  @ValidateNested({ each: true })
  @Type(() => FeedbackScoreDto)
  scores: FeedbackScoreDto[];

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  strengths?: string | null;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  concerns?: string | null;
}
