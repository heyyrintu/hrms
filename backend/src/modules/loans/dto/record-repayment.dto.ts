import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A repayment made outside payroll — cash, a bank transfer, a lump-sum
 * prepayment. Payroll-driven repayments are written by
 * `LoansService.recordPayrollRepayments` and never come through this DTO.
 */
export class RecordRepaymentDto {
  @ApiProperty({ description: 'Calendar month the repayment is for (1-12)' })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ description: 'Calendar year the repayment is for' })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ description: 'Amount repaid, in rupees' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ description: 'Free-text note, e.g. the transfer reference' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
