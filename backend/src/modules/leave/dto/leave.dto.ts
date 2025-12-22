import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLeaveRequestDto {
  @IsUUID()
  leaveTypeId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ApproveLeaveDto {
  @IsOptional()
  @IsString()
  approverNote?: string;
}

export class RejectLeaveDto {
  @IsOptional()
  @IsString()
  approverNote?: string;
}

export class LeaveBalanceQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  year?: number;
}

export class LeaveRequestQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
}

export class CreateLeaveTypeDto {
  @IsString()
  name: string;

  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  defaultDays?: number;

  @IsOptional()
  carryForward?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxCarryForward?: number;

  @IsOptional()
  isPaid?: boolean;
}

export class UpdateLeaveBalanceDto {
  @IsNumber()
  @Min(0)
  totalDays: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  carriedOver?: number;
}
