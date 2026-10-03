import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TimesheetStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TimesheetEntryDto {
  @ApiProperty({ example: '2026-03-16', description: 'Day within the week (YYYY-MM-DD)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be a YYYY-MM-DD date' })
  date: string;

  @ApiProperty()
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  taskId?: string | null;

  @ApiProperty({ example: 7.5, minimum: 0.01, maximum: 24 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(24)
  hours: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class SaveTimesheetEntriesDto {
  @ApiProperty({ type: [TimesheetEntryDto], description: 'Replaces the week (at most 200)' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TimesheetEntryDto)
  entries: TimesheetEntryDto[];
}

export class TimesheetDecisionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MyWeekQueryDto {
  @ApiProperty({ example: '2026-03-16' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'weekStart must be a YYYY-MM-DD date' })
  weekStart: string;
}

export class MyTimesheetsQueryDto {
  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AllTimesheetsQueryDto {
  @ApiPropertyOptional({ enum: TimesheetStatus })
  @IsOptional()
  @IsEnum(TimesheetStatus)
  status?: TimesheetStatus;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
