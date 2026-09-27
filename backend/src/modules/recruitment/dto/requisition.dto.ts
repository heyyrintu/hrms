import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { EmploymentType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateRequisitionDto {
  @ApiProperty({ description: 'Job title being requisitioned' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  designationId?: string;

  @ApiPropertyOptional({ description: 'Employee id of the hiring manager' })
  @IsOptional()
  @IsUUID()
  hiringManagerId?: string;

  @ApiProperty({ default: 1 })
  @IsInt()
  @Min(1)
  @Max(1000)
  headcount: number;

  @ApiPropertyOptional({ enum: EmploymentType })
  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @ApiPropertyOptional({ description: 'Annual CTC budget per position, minimum' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetMin?: number;

  @ApiPropertyOptional({ description: 'Annual CTC budget per position, maximum' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  justification?: string;
}

export class UpdateRequisitionDto extends PartialType(CreateRequisitionDto) {}
