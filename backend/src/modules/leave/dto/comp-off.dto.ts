import { IsString, IsOptional, IsDateString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompOffDto {
  @ApiProperty({ example: '2026-02-08', description: 'Date when employee worked (holiday/weekend)' })
  @IsDateString()
  workedDate: string;

  @ApiProperty({ example: 'Worked on Saturday for project deadline' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({ example: 1.0, default: 1.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  earnedDays?: number;
}

export class ApproveCompOffDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  approverNote?: string;
}

export class CompOffQueryDto {
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
