import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceRequestStatus, AttendanceRequestType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAttendanceRequestDto {
  @ApiProperty({ enum: AttendanceRequestType })
  @IsEnum(AttendanceRequestType)
  type: AttendanceRequestType;

  @ApiProperty({ example: '2026-03-16', description: 'First day, YYYY-MM-DD' })
  @IsDateString()
  fromDate: string;

  @ApiProperty({ example: '2026-03-18', description: 'Last day, YYYY-MM-DD' })
  @IsDateString()
  toDate: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'On-duty requests only' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}

export class AttendanceRequestDecisionDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MyAttendanceRequestsQueryDto {
  @ApiPropertyOptional({ enum: AttendanceRequestStatus })
  @IsOptional()
  @IsEnum(AttendanceRequestStatus)
  status?: AttendanceRequestStatus;

  @ApiPropertyOptional({ example: '2026-03-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AllAttendanceRequestsQueryDto extends MyAttendanceRequestsQueryDto {
  @ApiPropertyOptional({ enum: AttendanceRequestType })
  @IsOptional()
  @IsEnum(AttendanceRequestType)
  type?: AttendanceRequestType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
