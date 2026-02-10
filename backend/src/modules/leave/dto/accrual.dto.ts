import {
  IsString,
  IsUUID,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAccrualRuleDto {
  @ApiProperty({ description: 'Leave type ID' })
  @IsUUID()
  leaveTypeId: string;

  @ApiProperty({ description: 'Days to accrue per month', example: 1.5 })
  @IsNumber()
  @Min(0)
  monthlyAccrualDays: number;

  @ApiPropertyOptional({ description: 'Maximum balance cap', example: 30 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxBalanceCap?: number;

  @ApiPropertyOptional({
    description: 'Apply cap during accrual',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  applyCapOnAccrual?: boolean;
}

export class UpdateAccrualRuleDto extends CreateAccrualRuleDto {}

export class TriggerAccrualDto {
  @ApiProperty({ description: 'Target month (1-12)' })
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ description: 'Target year', example: 2025 })
  @IsInt()
  @Min(2020)
  year: number;

  @ApiPropertyOptional({
    description: 'Specific employee IDs (empty = all active)',
  })
  @IsOptional()
  @IsString({ each: true })
  employeeIds?: string[];

  @ApiPropertyOptional({
    description: 'Specific leave type IDs (empty = all with rules)',
  })
  @IsOptional()
  @IsString({ each: true })
  leaveTypeIds?: string[];
}

export class AccrualRunQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2020)
  year?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class UpdateLeaveBalanceFullDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalDays: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  usedDays: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  pendingDays: number;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  carriedOver: number;
}
