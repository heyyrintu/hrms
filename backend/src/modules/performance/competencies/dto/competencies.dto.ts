import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCompetencyDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional({ description: 'Inactive competencies are not snapshotted at launch' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCompetencyDto extends PartialType(CreateCompetencyDto) {}

export class DesignationCompetencyItemDto {
  @ApiProperty()
  @IsUUID()
  competencyId: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  expectedLevel: number;
}

export class SetDesignationCompetenciesDto {
  @ApiProperty({ type: [DesignationCompetencyItemDto], description: 'Replaces the designation\'s whole list' })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DesignationCompetencyItemDto)
  items: DesignationCompetencyItemDto[];
}
