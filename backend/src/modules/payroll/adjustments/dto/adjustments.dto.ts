import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { OneTimePaymentKind, SalaryArrearStatus, SalaryHoldStatus } from '@prisma/client';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ============================================
// One-time payments (spec C2)
// ============================================

export class CreateOneTimePaymentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ enum: OneTimePaymentKind })
  @IsEnum(OneTimePaymentKind)
  kind: OneTimePaymentKind;

  @ApiProperty({ description: 'Payslip label, 1-100 characters', maxLength: 100 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: 'Rupees, greater than zero, at most 2 decimals' })
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Earnings only; ignored for deductions. Default true.' })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

// ============================================
// Arrears (spec C1)
// ============================================

export class ArrearQueryDto {
  @ApiPropertyOptional({ enum: SalaryArrearStatus })
  @IsOptional()
  @IsEnum(SalaryArrearStatus)
  status?: SalaryArrearStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;
}

export class DetectArrearsDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  employeeId: string;
}

// ============================================
// Holds (spec C3)
// ============================================

export class HoldSalaryDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class HoldQueryDto {
  @ApiPropertyOptional({ enum: SalaryHoldStatus })
  @IsOptional()
  @IsEnum(SalaryHoldStatus)
  status?: SalaryHoldStatus;
}

export class ReleaseHoldDto {
  @ApiProperty({ description: 'A DRAFT or COMPUTED run to pay the held salary in' })
  @IsString()
  @IsNotEmpty()
  targetRunId: string;
}

export class VoidHoldDto {
  @ApiProperty({ maxLength: 500 })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

// ============================================
// Settlements through an off-cycle run (spec C5)
// ============================================

export class AttachSettlementDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  settlementId: string;
}

// ============================================
// Settings
// ============================================

export class UpdatePayrollSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reimburseExpensesViaPayroll?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoArrears?: boolean;
}
