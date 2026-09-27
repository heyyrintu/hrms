import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentCategory } from '@prisma/client';

/** One entry of the pre-onboarding checklist. */
export class PreOnboardingDocumentDefinitionDto {
  @ApiPropertyOptional({ example: 'photo_id' })
  @IsString()
  @Matches(/^[a-z0-9_]{1,50}$/, {
    message: 'key must be lower-case letters, digits or underscores, up to 50 characters',
  })
  key: string;

  @ApiPropertyOptional({ example: 'Government photo ID' })
  @IsString()
  @MaxLength(100)
  label: string;

  @ApiPropertyOptional({ enum: DocumentCategory })
  @IsEnum(DocumentCategory)
  category: DocumentCategory;

  @ApiPropertyOptional()
  @IsBoolean()
  required: boolean;
}

/** `PUT /recruitment/settings`. Every field optional; only supplied keys change. */
export class UpdateRecruitmentSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  careersPageEnabled?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsString()
  @MaxLength(5000)
  careersIntro?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  offerExpiryDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  preOnboardingExpiryDays?: number;

  @ApiPropertyOptional({ type: [PreOnboardingDocumentDefinitionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreOnboardingDocumentDefinitionDto)
  preOnboardingDocuments?: PreOnboardingDocumentDefinitionDto[];
}
