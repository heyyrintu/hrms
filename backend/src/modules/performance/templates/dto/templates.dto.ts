import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewAudience, ReviewQuestionType } from '@prisma/client';

export class CreateQuestionDto {
  @ApiProperty({ description: 'The question text (1-500 chars)' })
  @IsString()
  @Length(1, 500)
  text: string;

  @ApiProperty({ enum: ReviewQuestionType })
  @IsEnum(ReviewQuestionType)
  type: ReviewQuestionType;

  @ApiPropertyOptional({ description: 'Free-form grouping label (max 100 chars)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateQuestionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  text?: string;

  @ApiPropertyOptional({ enum: ReviewQuestionType })
  @IsOptional()
  @IsEnum(ReviewQuestionType)
  type?: ReviewQuestionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class TemplateEntryDto {
  @ApiProperty()
  @IsUUID()
  questionId: string;

  @ApiProperty({ enum: ReviewAudience })
  @IsEnum(ReviewAudience)
  audience: ReviewAudience;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @ApiPropertyOptional({ description: 'Defaults to the entry index' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class CreateTemplateDto {
  @ApiProperty({ description: 'Unique per tenant (1-100 chars)' })
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ type: [TemplateEntryDto], description: '1-50 entries' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  questions: TemplateEntryDto[];
}

export class UpdateTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    type: [TemplateEntryDto],
    description: 'When present, replaces the whole entry list',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TemplateEntryDto)
  questions?: TemplateEntryDto[];
}
