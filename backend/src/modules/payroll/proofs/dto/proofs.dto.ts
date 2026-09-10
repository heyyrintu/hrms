import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvestmentProofSection, InvestmentProofStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Bounds on a financial year, wide enough to be useless as a validation trap. */
const FIRST_FINANCIAL_YEAR = 2000;
const LAST_FINANCIAL_YEAR = 2100;

/**
 * File one document as evidence for one deduction head.
 *
 * The file itself is uploaded first through `POST /uploads`; this carries only
 * the id of the resulting `Upload`. That keeps one upload path in the codebase
 * rather than two, and means the size and type limits enforced there apply to
 * proofs without being restated.
 */
export class SubmitProofDto {
  @ApiProperty({
    description: 'The financial year the evidence belongs to. FY 2026-27 is 2026.',
    example: 2026,
  })
  @IsInt()
  @Min(FIRST_FINANCIAL_YEAR)
  @Max(LAST_FINANCIAL_YEAR)
  financialYear!: number;

  @ApiProperty({ enum: InvestmentProofSection })
  @IsEnum(InvestmentProofSection)
  section!: InvestmentProofSection;

  @ApiProperty({
    description: 'What the employee says the document supports, in rupees.',
    example: 50000,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  claimedAmount!: number;

  @ApiProperty({ description: 'Id of an Upload created through POST /uploads' })
  @IsString()
  @IsNotEmpty()
  uploadId!: string;

  @ApiPropertyOptional({ description: 'What the document is, in the words of the filer' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/**
 * Accept a proof, in whole or in part.
 *
 * `verifiedAmount` is mandatory: an approval that did not say what was accepted
 * would leave the payroll with nothing to work from. It may be lower than the
 * claim — a reviewer who can read only part of a receipt should be able to
 * accept that part — but never higher, which the service refuses.
 */
export class ApproveProofDto {
  @ApiProperty({
    description:
      'What the reviewer accepted, in rupees. May be less than claimed, never more.',
    example: 45000,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  verifiedAmount!: number;

  @ApiPropertyOptional({
    description: 'Why less than the full claim was accepted, where that is the case',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNote?: string;
}

/**
 * Refuse a proof.
 *
 * The reason is required. An employee whose evidence is refused has to fix
 * something, and cannot do that without being told what. The service enforces
 * this a second time, so the rule holds for any caller, not only one that came
 * through the validation pipe.
 */
export class RejectProofDto {
  @ApiProperty({ description: 'Why the evidence was refused' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reviewNote!: string;
}

/** Filters for one employee's own list of proofs. */
export class MyProofsQueryDto {
  @ApiPropertyOptional({
    description: 'FY 2026-27 is 2026. Defaults to the financial year in progress.',
  })
  @IsOptional()
  @IsInt()
  @Min(FIRST_FINANCIAL_YEAR)
  @Max(LAST_FINANCIAL_YEAR)
  financialYear?: number;
}

/**
 * Filters for the review queue.
 *
 * All optional and all narrowing: an unfiltered call returns every proof in the
 * tenant, which is the right default for a queue nobody has triaged yet.
 */
export class ProofQueueQueryDto {
  @ApiPropertyOptional({ description: 'FY 2026-27 is 2026' })
  @IsOptional()
  @IsInt()
  @Min(FIRST_FINANCIAL_YEAR)
  @Max(LAST_FINANCIAL_YEAR)
  financialYear?: number;

  @ApiPropertyOptional({ enum: InvestmentProofStatus })
  @IsOptional()
  @IsEnum(InvestmentProofStatus)
  status?: InvestmentProofStatus;

  @ApiPropertyOptional({ description: 'Restrict the queue to one employee' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  employeeId?: string;
}
