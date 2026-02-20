import { IsString, IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRegularizationDto {
  @ApiProperty({ example: '2026-02-10' })
  @IsDateString()
  date: string;

  @ApiProperty({ example: '2026-02-10T09:00:00Z' })
  @IsDateString()
  requestedClockIn: string;

  @ApiProperty({ example: '2026-02-10T18:00:00Z' })
  @IsDateString()
  requestedClockOut: string;

  @ApiProperty({ example: 'Forgot to clock in' })
  @IsString()
  reason: string;
}

export class ApproveRegularizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approverNote?: string;
}

export class RegularizationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
