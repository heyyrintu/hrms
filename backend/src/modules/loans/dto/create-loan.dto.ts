import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanType } from '@prisma/client';

/**
 * The longest tenure the business will underwrite: ten years.
 * A salary advance is capped far shorter — see `SALARY_ADVANCE_MAX_TENURE`.
 */
export const LOAN_MAX_TENURE_MONTHS = 120;

/**
 * A salary advance is a bridge to the next few paydays, not a loan, so it is
 * always interest free and never runs past a year.
 */
export const SALARY_ADVANCE_MAX_TENURE_MONTHS = 12;

export class CreateLoanDto {
  @ApiProperty({
    enum: LoanType,
    description:
      'LOAN for a staff loan, SALARY_ADVANCE for an interest-free advance against salary',
  })
  @IsEnum(LoanType)
  type: LoanType;

  @ApiProperty({ description: 'Amount requested, in rupees' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100000000)
  principal: number;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Annual simple interest rate as a percentage. Must be 0 for a salary advance.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  interestRate?: number;

  @ApiProperty({
    description: `Number of monthly instalments. 1..${LOAN_MAX_TENURE_MONTHS} for a loan, 1..${SALARY_ADVANCE_MAX_TENURE_MONTHS} for a salary advance.`,
  })
  @IsInt()
  @Min(1)
  @Max(LOAN_MAX_TENURE_MONTHS)
  tenureMonths: number;

  @ApiProperty({ description: 'Calendar month the first instalment falls in (1-12)' })
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth: number;

  @ApiProperty({ description: 'Calendar year the first instalment falls in' })
  @IsInt()
  @Min(2000)
  @Max(2100)
  startYear: number;

  @ApiPropertyOptional({ description: 'Why the money is needed' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  purpose?: string;
}
