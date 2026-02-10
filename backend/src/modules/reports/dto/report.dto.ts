import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ReportFormat {
  CSV = 'csv',
  XLSX = 'xlsx',
}

export enum ReportType {
  ATTENDANCE = 'attendance',
  LEAVE = 'leave',
  EMPLOYEE = 'employee',
}

export class AttendanceReportDto {
  @ApiProperty({ description: 'Start date (YYYY-MM-DD)' })
  @IsDateString()
  from: string;

  @ApiProperty({ description: 'End date (YYYY-MM-DD)' })
  @IsDateString()
  to: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ enum: ReportFormat, default: ReportFormat.XLSX })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}

export class LeaveReportDto {
  @ApiPropertyOptional({ description: 'Year for balances/usage (defaults to current year)' })
  @IsOptional()
  @IsString()
  year?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ enum: ReportFormat, default: ReportFormat.XLSX })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}

export class EmployeeReportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employmentType?: string;

  @ApiPropertyOptional({ enum: ReportFormat, default: ReportFormat.XLSX })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;
}
