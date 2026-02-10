import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ============================================
// Salary Structure DTOs
// ============================================

export class SalaryComponentDto {
  @ApiProperty({ description: 'Component name (e.g., HRA, Conveyance)' })
  @IsString()
  name: string;

  @ApiProperty({ enum: ['earning', 'deduction'] })
  @IsEnum(['earning', 'deduction'] as const)
  type: 'earning' | 'deduction';

  @ApiProperty({
    enum: ['fixed', 'percentage'],
    description: 'fixed = flat amount, percentage = % of basePay',
  })
  @IsEnum(['fixed', 'percentage'] as const)
  calcType: 'fixed' | 'percentage';

  @ApiProperty({ description: 'Amount or percentage value' })
  @IsNumber()
  @Min(0)
  value: number;
}

export class CreateSalaryStructureDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [SalaryComponentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components: SalaryComponentDto[];
}

export class UpdateSalaryStructureDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [SalaryComponentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalaryComponentDto)
  components?: SalaryComponentDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ============================================
// Employee Salary DTOs
// ============================================

export class AssignSalaryDto {
  @ApiProperty()
  @IsString()
  salaryStructureId: string;

  @ApiProperty({ description: 'Monthly base pay amount' })
  @IsNumber()
  @Min(0)
  basePay: number;

  @ApiProperty({ description: 'Effective from date (YYYY-MM-DD)' })
  @IsDateString()
  effectiveFrom: string;

  @ApiPropertyOptional({ description: 'Effective to date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

// ============================================
// Payroll Run DTOs
// ============================================

export class CreatePayrollRunDto {
  @ApiProperty({ description: 'Month (1-12)' })
  @IsNumber()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ description: 'Year (e.g., 2026)' })
  @IsNumber()
  @Min(2020)
  year: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ============================================
// Query DTOs
// ============================================

export class PayrollRunQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  year?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

export class PayslipQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  limit?: string;
}
