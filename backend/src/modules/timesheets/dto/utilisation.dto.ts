import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';

export const UTILISATION_GROUP_BY = ['employee', 'project'] as const;
export type UtilisationGroupBy = (typeof UTILISATION_GROUP_BY)[number];

export class UtilisationQueryDto {
  @ApiProperty({ example: '2026-03-01' })
  @IsDateString()
  from: string;

  @ApiProperty({ example: '2026-03-31', description: 'At most 92 days after `from`' })
  @IsDateString()
  to: string;

  @ApiProperty({ enum: UTILISATION_GROUP_BY })
  @IsIn(UTILISATION_GROUP_BY)
  groupBy: UtilisationGroupBy;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ default: false, description: 'Also count SUBMITTED timesheets' })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsOptional()
  @IsBoolean()
  includeSubmitted?: boolean;
}
