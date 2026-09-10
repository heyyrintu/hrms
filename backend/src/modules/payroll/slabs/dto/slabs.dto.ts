import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaxAgeBand, TaxRegime } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Bounds on a financial year, wide enough to be useless as a validation trap. */
const FIRST_FINANCIAL_YEAR = 2000;
const LAST_FINANCIAL_YEAR = 2100;

// ---------------------------------------------------------------------------
// Professional tax
// ---------------------------------------------------------------------------

/**
 * One professional tax band for one state.
 *
 * Used for both create and update: an update replaces the whole row, so a
 * caller cannot patch a single field and leave the rest to drift from what is
 * shown on screen.
 */
export class ProfessionalTaxSlabDto {
  @ApiProperty({ description: 'The state this band applies in', example: 'Karnataka' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  state!: string;

  @ApiProperty({ description: 'Inclusive lower bound of monthly gross', example: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fromAmount!: number;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound of monthly gross; omit for the top band',
    example: 25000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  toAmount?: number | null;

  @ApiProperty({ description: 'Amount deducted in a normal month', example: 200 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @ApiPropertyOptional({
    description: 'Maharashtra deducts a higher figure in February; omit elsewhere',
    example: 300,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  februaryAmount?: number | null;

  @ApiPropertyOptional({
    description: "Restricts the band to one gender where the state distinguishes; omit for all",
    example: 'female',
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  gender?: string | null;
}

/** Filter for the professional tax list. */
export class ProfessionalTaxSlabQueryDto {
  @ApiPropertyOptional({ description: 'Restrict the list to one state' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  state?: string;
}

// ---------------------------------------------------------------------------
// Income tax
// ---------------------------------------------------------------------------

/** One rung of an income tax ladder. */
export class IncomeTaxSlabRowDto {
  @ApiProperty({ description: 'Inclusive lower bound of taxable income', example: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  fromAmount!: number;

  @ApiPropertyOptional({
    description: 'Inclusive upper bound of taxable income; omit for the top slab',
    example: 400000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  toAmount?: number | null;

  @ApiProperty({ description: 'Percent', example: 5 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate!: number;
}

/**
 * Create or replace the income tax configuration for one financial year,
 * regime and age band, including its whole slab ladder.
 *
 * There is deliberately no "patch a slab" endpoint: a ladder is only
 * meaningful as a complete set, and replacing it row by row is how a ladder
 * ends up with a gap nobody meant to leave.
 */
export class IncomeTaxConfigDto {
  @ApiProperty({ description: 'FY 2026-27 is 2026', example: 2026 })
  @IsInt()
  @Min(FIRST_FINANCIAL_YEAR)
  @Max(LAST_FINANCIAL_YEAR)
  financialYear!: number;

  @ApiProperty({ enum: TaxRegime })
  @IsEnum(TaxRegime)
  regime!: TaxRegime;

  @ApiProperty({ enum: TaxAgeBand })
  @IsEnum(TaxAgeBand)
  ageBand!: TaxAgeBand;

  @ApiPropertyOptional({ description: 'Defaults to 0', example: 50000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  standardDeduction?: number;

  @ApiPropertyOptional({
    description: 'Section 87A: taxable income at or below which the rebate applies. Defaults to 0',
    example: 700000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rebateIncomeLimit?: number;

  @ApiPropertyOptional({
    description: 'Section 87A: the most the rebate can be worth. Defaults to 0',
    example: 25000,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  rebateMaxAmount?: number;

  @ApiPropertyOptional({
    description: 'Health and education cess, percent of tax plus surcharge. Defaults to 4',
    example: 4,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  cessRate?: number;

  @ApiPropertyOptional({ description: 'Defaults to 150000', example: 150000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  section80CLimit?: number;

  @ApiPropertyOptional({ description: 'Defaults to 25000', example: 25000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  section80DLimit?: number;

  @ApiPropertyOptional({ description: 'Defaults to 50000', example: 50000 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  section80CCD1BLimit?: number;

  @ApiPropertyOptional({
    description: 'Section 10(14) monthly ceiling per child. Defaults to 100',
    example: 100,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  childrenEducationMonthlyLimit?: number;

  @ApiPropertyOptional({
    description: 'Section 10(14) monthly hostel ceiling per child. Defaults to 300',
    example: 300,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  hostelAllowanceMonthlyLimit?: number;

  @ApiPropertyOptional({
    description: 'The most children the section 10(14) allowances may be claimed for. Defaults to 2',
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  childrenAllowanceMaxChildren?: number;

  @ApiPropertyOptional({ description: 'Whether marginal relief applies to surcharge. Defaults to true' })
  @IsOptional()
  @IsBoolean()
  marginalReliefEnabled?: boolean;

  @ApiProperty({
    type: [IncomeTaxSlabRowDto],
    description:
      'The whole ladder. Bands must not overlap or leave a gap, must start at ' +
      'zero, and exactly one may be open-ended at the top.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IncomeTaxSlabRowDto)
  slabs!: IncomeTaxSlabRowDto[];
}

/** Filter for the income tax configuration list. */
export class IncomeTaxConfigQueryDto {
  @ApiPropertyOptional({ description: 'FY 2026-27 is 2026' })
  @IsOptional()
  @IsInt()
  @Min(FIRST_FINANCIAL_YEAR)
  @Max(LAST_FINANCIAL_YEAR)
  financialYear?: number;
}
