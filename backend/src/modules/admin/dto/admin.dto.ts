import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { EmploymentType } from '@prisma/client';

export class CreateOtRuleDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employmentType?: EmploymentType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyThresholdMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weeklyThresholdMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  roundingIntervalMinutes?: number;

  @IsOptional()
  @IsBoolean()
  requiresManagerApproval?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxOtPerDayMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxOtPerMonthMinutes?: number;
}

export class UpdateOtRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  dailyThresholdMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weeklyThresholdMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  roundingIntervalMinutes?: number;

  @IsOptional()
  @IsBoolean()
  requiresManagerApproval?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxOtPerDayMinutes?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxOtPerMonthMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class DashboardStatsDto {
  totalEmployees: number;
  activeEmployees: number;
  presentToday: number;
  onLeaveToday: number;
  pendingLeaveRequests: number;
  pendingOtApprovals: number;
}
