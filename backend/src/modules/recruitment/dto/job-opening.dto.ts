import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { EmploymentType } from '@prisma/client';
import {
  IsBoolean,
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

export class CreateJobOpeningDto {
  @ApiPropertyOptional({ description: 'Approved requisition this opening fills' })
  @IsOptional()
  @IsUUID()
  requisitionId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requirements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  designationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: EmploymentType })
  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  experienceMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  experienceMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salaryMin?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salaryMax?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  showSalary?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  positions?: number;

  @ApiPropertyOptional({ description: 'Employee id of the hiring manager' })
  @IsOptional()
  @IsUUID()
  hiringManagerId?: string;
}

export class UpdateJobOpeningDto extends PartialType(CreateJobOpeningDto) {}
