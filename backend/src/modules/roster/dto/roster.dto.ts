import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MESSAGE = 'must be a YYYY-MM-DD date';

export class RotationPatternDto {
  @ApiProperty({ example: '2 days, 2 nights, 3 off' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    type: [String],
    nullable: true,
    description: 'One entry per day of the cycle: a shift id, or null for OFF. 1 to 31 entries.',
    example: ['shift-id-1', 'shift-id-1', null],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(31)
  days: (string | null)[];
}

export class ApplyRosterDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  patternId: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  employeeIds: string[];

  @ApiProperty({ example: '2026-03-16' })
  @Matches(DATE_ONLY, { message: `startDate ${DATE_MESSAGE}` })
  startDate: string;

  @ApiProperty({ example: '2026-04-12' })
  @Matches(DATE_ONLY, { message: `endDate ${DATE_MESSAGE}` })
  endDate: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 30, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  cycleOffset?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  overwriteManual?: boolean;
}

export class RosterCellDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: '2026-03-16' })
  @Matches(DATE_ONLY, { message: `date ${DATE_MESSAGE}` })
  date: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  shiftId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isOff?: boolean;

  @ApiPropertyOptional({ description: 'Delete the entry so the day falls back to the assignment.' })
  @IsOptional()
  @IsBoolean()
  clear?: boolean;
}

export class UpdateRosterCellsDto {
  @ApiProperty({ type: [RosterCellDto], description: 'Up to 1000 cells.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RosterCellDto)
  cells: RosterCellDto[];
}

export class RosterGridQueryDto {
  @ApiProperty({ example: '2026-03-16' })
  @Matches(DATE_ONLY, { message: `from ${DATE_MESSAGE}` })
  from: string;

  @ApiProperty({ example: '2026-03-29', description: 'At most 42 days after from.' })
  @Matches(DATE_ONLY, { message: `to ${DATE_MESSAGE}` })
  to: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional({ description: 'Comma-separated employee ids.' })
  @IsOptional()
  @IsString()
  employeeIds?: string;
}

export class MyRosterQueryDto {
  @ApiProperty({ example: '2026-03-16' })
  @Matches(DATE_ONLY, { message: `from ${DATE_MESSAGE}` })
  from: string;

  @ApiProperty({ example: '2026-03-29', description: 'At most 42 days after from.' })
  @Matches(DATE_ONLY, { message: `to ${DATE_MESSAGE}` })
  to: string;
}
