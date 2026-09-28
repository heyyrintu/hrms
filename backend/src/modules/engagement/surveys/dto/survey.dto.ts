import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { EngagementAudience, SurveyQuestionType, SurveyStatus } from '@prisma/client';

export class SurveyQuestionDto {
  @ApiProperty({ enum: SurveyQuestionType })
  @IsEnum(SurveyQuestionType)
  type: SurveyQuestionType;

  @ApiProperty({ description: 'The question text' })
  @IsString()
  @Length(1, 500)
  text: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Choice labels for SINGLE_CHOICE/MULTI_CHOICE; omitted otherwise',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

export class CreateSurveyDto {
  @ApiProperty()
  @IsString()
  @Length(1, 200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean;

  @ApiProperty({ enum: EngagementAudience })
  @IsEnum(EngagementAudience)
  audienceType: EngagementAudience;

  @ApiProperty({
    type: [String],
    description: 'Department ids or branch ids per audienceType; [] for ALL',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  audienceIds: string[];

  @ApiPropertyOptional({ description: 'ISO date-time the survey stops accepting responses' })
  @IsOptional()
  @IsISO8601()
  closesAt?: string;

  @ApiProperty({ type: [SurveyQuestionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SurveyQuestionDto)
  questions: SurveyQuestionDto[];
}

export class UpdateSurveyDto extends PartialType(CreateSurveyDto) {}

export class ListSurveysDto {
  @ApiPropertyOptional({ enum: SurveyStatus })
  @IsOptional()
  @IsEnum(SurveyStatus)
  status?: SurveyStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number = 20;
}

export class AnswerDto {
  @ApiProperty()
  @IsUUID()
  questionId: string;

  @ApiPropertyOptional({ description: 'TEXT answer' })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'SINGLE_CHOICE/MULTI_CHOICE selected option labels',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  choices?: string[];

  @ApiPropertyOptional({ description: 'RATING (1-5) or ENPS (0-10) value' })
  @IsOptional()
  @IsInt()
  value?: number;
}

export class SubmitSurveyDto {
  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers: AnswerDto[];
}
