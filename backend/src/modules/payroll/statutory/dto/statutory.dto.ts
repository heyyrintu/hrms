import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaxRegime } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Every field is optional: the endpoint patches the tenant's configuration
 * rather than replacing it, so a caller can switch one levy on without
 * restating every rate.
 */
export class UpdateStatutoryConfigDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pfEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) pfEmployeeRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) pfEmployerRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) epsRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) pfWageCeiling?: number;
  @ApiPropertyOptional({
    description:
      'Cap the employee and employer shares at the ceiling. The pension share is capped either way.',
  })
  @IsOptional()
  @IsBoolean()
  applyPfCeiling?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) edliRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) pfAdminRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) pfAdminMinimum?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() esiEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) esiEmployeeRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) esiEmployerRate?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) esiWageLimit?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() ptEnabled?: boolean;
  @ApiPropertyOptional({ description: 'Which state slab table applies.' })
  @IsOptional()
  @IsString()
  ptState?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() lwfEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) lwfEmployeeAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) lwfEmployerAmount?: number;
  @ApiPropertyOptional({
    description: 'Calendar months (1-12) in which the state collects the fund.',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  lwfMonths?: number[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean() tdsEnabled?: boolean;
  @ApiPropertyOptional({ enum: TaxRegime })
  @IsOptional()
  @IsEnum(TaxRegime)
  defaultTaxRegime?: TaxRegime;
}

/**
 * What an employee declares for the year. These are declarations, not proofs:
 * no evidence is collected or approved, so treat the resulting TDS as an
 * estimate until proofs are verified out of band.
 */
export class UpsertTaxDeclarationDto {
  @ApiPropertyOptional({ description: 'FY 2025-26 is 2025. Defaults to the current year.' })
  @IsOptional()
  @IsInt()
  financialYear?: number;

  @ApiPropertyOptional({ enum: TaxRegime })
  @IsOptional()
  @IsEnum(TaxRegime)
  regime?: TaxRegime;

  @ApiPropertyOptional({ description: 'Capped at 1,50,000 by statute.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  section80C?: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) section80D?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) section80CCD1B?: number;
  @ApiPropertyOptional({ description: 'Employer NPS contribution, allowed under both regimes.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  section80CCD2?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) hraExemption?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) homeLoanInterest?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) otherDeductions?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) otherIncome?: number;
  @ApiPropertyOptional({ description: 'Tax already deducted by a previous employer this year.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  previousEmployerTds?: number;
}
