import {
  IsString,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus, AttendanceSource } from '@prisma/client';

export class ClockInDto {
  @IsOptional()
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ClockOutDto {
  @IsOptional()
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;

  @IsOptional()
  @IsNumber()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ApproveOtDto {
  @IsNumber()
  @Min(0)
  otMinutesApproved: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class AttendanceQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;
}

export class AttendanceSummaryQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class PayableHoursQueryDto {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}

export class ManualAttendanceDto {
  @IsUUID()
  employeeId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  clockInTime?: string;

  @IsOptional()
  @IsDateString()
  clockOutTime?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  breakMinutes?: number;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class BulkAttendanceDto {
  records: ManualAttendanceDto[];
}
