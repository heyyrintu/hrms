import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AccountingCostCenterMode } from '@prisma/client';
import { AccountingExportFormat } from '../accounting.types';

/**
 * WS-C2 (Keka wave C, spec C7/C8) request DTOs.
 *
 * `suspenseGlCode` / `suspenseGlName` / `tallyCompanyName` accept an empty
 * string to clear a previously configured value back to null; the service
 * treats a blank string that way rather than as a validation failure, since
 * "stop using a suspense account" is a normal configuration change.
 */
export class UpdateAccountingConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  suspenseGlCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  suspenseGlName?: string;

  @ApiPropertyOptional({ enum: AccountingCostCenterMode })
  @IsOptional()
  @IsEnum(AccountingCostCenterMode)
  costCenterMode?: AccountingCostCenterMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  tallyCompanyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tallyVoucherType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  narrationTemplate?: string;
}

export class GlMappingItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  componentKey: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  glCode: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  glName: string;
}

export class ReplaceGlMappingsDto {
  @ApiProperty({ type: [GlMappingItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GlMappingItemDto)
  mappings: GlMappingItemDto[];
}

export class JournalQueryDto {
  @ApiPropertyOptional({ description: "'true' to post unmapped keys to the suspense account" })
  @IsOptional()
  @IsString()
  allowUnmapped?: string;
}

export class ExportQueryDto extends JournalQueryDto {
  @ApiProperty({ enum: ['csv', 'tally'] })
  @IsIn(['csv', 'tally'])
  format: AccountingExportFormat;
}

export class VarianceQueryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  runId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  compareRunId?: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  thresholdPct?: number;
}
