import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LetterType } from '@prisma/client';

// ============================================
// Template DTOs
// ============================================

export class CreateLetterTemplateDto {
  @ApiProperty({ description: 'Template name' })
  @IsString()
  name: string;

  @ApiProperty({ enum: LetterType, description: 'Letter type' })
  @IsEnum(LetterType)
  type: LetterType;

  @ApiProperty({ description: 'Handlebars HTML content with placeholders like {{employeeName}}' })
  @IsString()
  content: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateLetterTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: LetterType })
  @IsOptional()
  @IsEnum(LetterType)
  type?: LetterType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  content?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================
// Generate Letter DTO
// ============================================

export class GenerateLetterDto {
  @ApiProperty({ description: 'Template ID to generate letter from' })
  @IsString()
  templateId: string;

  @ApiProperty({ description: 'Employee ID to generate letter for' })
  @IsString()
  employeeId: string;
}

// ============================================
// Query DTO
// ============================================

export class LetterQueryDto {
  @ApiPropertyOptional({ enum: LetterType })
  @IsOptional()
  @IsEnum(LetterType)
  type?: LetterType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;
}
