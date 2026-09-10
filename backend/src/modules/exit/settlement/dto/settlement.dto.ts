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
 * The figures a settlement cannot derive on its own, and the override on the
 * one it can.
 *
 * `otherEarnings` and `otherRecoveries` are recomputed from nothing: they are
 * entered by whoever is processing the exit and are preserved across a
 * recompute only if they re-enter them.
 *
 * `tds` is different. It is now worked out from the leaver's position for the
 * financial year, and entering it here is an **override** of that figure — the
 * computed default stays recorded beside it, and the settlement's working shows
 * that a person, not the system, decided the number. The override survives a
 * recompute, because a recompute is not a reason to discard a decision somebody
 * made about facts the system cannot see: relief under section 89, income never
 * declared, an assessment already in hand.
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
    description:
      'Override the computed tax deducted at source. The computed figure is ' +
      'kept in the breakdown alongside it, and the override survives a recompute ' +
      'until it is cleared.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tds?: number;

  @ApiPropertyOptional({
    description: 'Why the computed tax was overridden. Recorded in the working.',
  })
  @IsOptional()
  @IsString()
  tdsOverrideReason?: string;

  @ApiPropertyOptional({
    description:
      'Drop a previous override and go back to the computed figure. Cannot be ' +
      'sent together with tds.',
  })
  @IsOptional()
  @IsBoolean()
  clearTdsOverride?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  remarks?: string;
}
