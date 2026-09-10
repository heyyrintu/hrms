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

  @ApiPropertyOptional({
    description:
      'Calendar months in which the state collects professional tax. Empty means every month, which is what most states do.',
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  ptMonths?: number[];

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

  // ---- Gratuity (Payment of Gratuity Act, 1972) ----
  // Held as configuration rather than constants because an employer may pay
  // better than the Act, and the section 10(10) ceiling has been revised more
  // than once. Rows nobody can edit through the API are constants in disguise.
  @ApiPropertyOptional() @IsOptional() @IsBoolean() gratuityEnabled?: boolean;
  @ApiPropertyOptional({ description: 'Days of wages per completed year. The Act says 15.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  gratuityDaysPerYear?: number;
  @ApiPropertyOptional({
    description: "Days treated as a month's wages. The Act says 26 for covered establishments.",
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  gratuityMonthDays?: number;
  @ApiPropertyOptional({ description: 'Completed years of service before gratuity is payable.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  gratuityMinYears?: number;
  @ApiPropertyOptional({
    description:
      'Lifetime exemption ceiling under section 10(10). Caps the exempt part, not the amount payable.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  gratuityExemptionCap?: number;

  // ---- Leave encashment on exit ----
  @ApiPropertyOptional() @IsOptional() @IsBoolean() leaveEncashmentEnabled?: boolean;
  @ApiPropertyOptional({
    description:
      'Section 10(10AA) lifetime ceiling for a non-government employee. Caps the exempt part, not the amount paid.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  encashmentExemptionCap?: number;
  @ApiPropertyOptional({ description: 'Days per completed year the section recognises. The Act says 30.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  encashmentExemptDaysPerYear?: number;
  @ApiPropertyOptional({ description: "Months of average salary the exemption is capped at. The Act says 10." })
  @IsOptional()
  @IsNumber()
  @Min(0)
  encashmentExemptMonths?: number;
  @ApiPropertyOptional({ description: 'Encashment paid by a government employer is exempt in full.' })
  @IsOptional()
  @IsBoolean()
  encashmentGovernmentEmployer?: boolean;
  @ApiPropertyOptional({ description: 'Days treated as a month when valuing an encashed day.' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  encashmentMonthDays?: number;

  // ---- Investment proofs ----
  @ApiPropertyOptional({
    description:
      'Require a verified proof before a declared deduction reduces TDS. Off by default, so an installation that does not opt in keeps taking declarations at face value.',
  })
  @IsOptional()
  @IsBoolean()
  proofVerificationRequired?: boolean;
  @ApiPropertyOptional({
    description:
      'Calendar month from which verified amounts replace declared ones. January by convention.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  proofCutoffMonth?: number;

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
