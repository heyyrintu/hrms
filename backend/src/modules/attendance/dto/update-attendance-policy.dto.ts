import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

/**
 * Every field is optional: the form sends only what the admin changed, and the
 * service applies exactly the keys that are present.
 */
export class UpdateAttendancePolicyDto {
  @ApiPropertyOptional({
    description: 'Shift start used when the employee has no shift assignment, HH:mm',
    example: '09:00',
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'defaultShiftStart must be a 24-hour HH:mm time',
  })
  defaultShiftStart?: string;

  @ApiPropertyOptional({ description: 'Minutes after shift start that are still on time' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  defaultGraceMinutes?: number;

  @ApiPropertyOptional({
    description:
      'Late marks in a calendar month that cost half a day. null disables the penalty.',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(31)
  lateMarksPerHalfDay?: number | null;

  @ApiPropertyOptional({ description: 'Run the nightly absent marker for this tenant' })
  @IsOptional()
  @IsBoolean()
  autoMarkAbsent?: boolean;

  @ApiPropertyOptional({ description: 'Count ABSENT days as loss of pay in payroll' })
  @IsOptional()
  @IsBoolean()
  absentIsLop?: boolean;

  @ApiPropertyOptional({ description: 'Worked minutes that earn half a day' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  minHalfDayMinutes?: number;

  @ApiPropertyOptional({ description: 'Worked minutes that earn a full day' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  minFullDayMinutes?: number;
}

/** Body of `POST /attendance/mark-absent`. */
export class MarkAbsentDto {
  @ApiProperty({ description: 'Calendar day to sweep, YYYY-MM-DD', example: '2026-03-16' })
  @IsDateString()
  date: string;
}
