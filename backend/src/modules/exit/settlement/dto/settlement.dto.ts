import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ComputeSettlementDto {
  /**
   * The Payment of Gratuity Act waives the five-year qualifying period on death
   * or permanent disablement. `SeparationType` has no member for either, so the
   * caller states it here rather than the service guessing from the type.
   */
  @ApiPropertyOptional({
    description:
      'Waive the minimum-service rule for gratuity (death or permanent disablement only)',
  })
  @IsOptional()
  @IsBoolean()
  waiveGratuityMinimumService?: boolean;
}

/**
 * The figures a settlement cannot derive on its own.
 *
 * Everything else on a settlement is recomputed from the employee's salary,
 * leave balances and dates; these four are entered by whoever is processing the
 * exit and are preserved across a recompute only if they re-enter them.
 */
export class UpdateSettlementDto {
  @ApiPropertyOptional({ description: 'Bonus, reimbursement, ex gratia' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherEarnings?: number;

  @ApiPropertyOptional({ description: 'Advances, asset losses, anything withheld' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherRecoveries?: number;

  @ApiPropertyOptional({
    description: 'Tax deducted at source on the settlement. Supplied, not computed.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;
}
