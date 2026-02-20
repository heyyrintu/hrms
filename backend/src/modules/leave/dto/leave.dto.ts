import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLeaveRequestDto {
  @ApiProperty()
  @IsUUID()
  leaveTypeId: string;

  @ApiProperty()
  @IsDateString()
  startDate: string;

  @ApiProperty()
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @ApiPropertyOptional({ enum: ['FIRST_HALF', 'SECOND_HALF'] })
  @IsOptional()
  @IsString()
  halfDayPeriod?: string;
}

export class ApproveLeaveDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approverNote?: string;
}

export class RejectLeaveDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approverNote?: string;
}

export class LeaveBalanceQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;
}

export class LeaveRequestQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}

export class CreateLeaveTypeDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  defaultDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  carryForward?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxCarryForward?: number;

  @ApiPropertyOptional()
  @IsOptional()
  isPaid?: boolean;
}

export class UpdateLeaveBalanceDto {
  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalDays: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  carriedOver?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  usedDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  pendingDays?: number;
}

export class AdminLeaveRequestQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leaveTypeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}

export class InitializeBalancesDto {
  @ApiProperty()
  @IsNumber()
  year: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString({ each: true })
  employeeIds?: string[];
}
