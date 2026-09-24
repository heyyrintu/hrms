import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkflowEntityType } from '@prisma/client';

export class CreateDelegationDto {
  @ApiProperty({ description: 'User who will approve on the delegator\'s behalf' })
  @IsString()
  @IsNotEmpty()
  delegateUserId: string;

  @ApiProperty({ description: 'First day of the delegation (YYYY-MM-DD, inclusive)', example: '2026-10-01' })
  @IsDateString({ strict: true })
  startDate: string;

  @ApiProperty({ description: 'Last day of the delegation (YYYY-MM-DD, inclusive)', example: '2026-10-07' })
  @IsDateString({ strict: true })
  endDate: string;

  @ApiPropertyOptional({ enum: WorkflowEntityType, description: 'Omit to delegate every request type' })
  @IsOptional()
  @IsEnum(WorkflowEntityType)
  entityType?: WorkflowEntityType;

  @ApiPropertyOptional({ description: 'Why, e.g. "On leave"' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'HR_ADMIN / SUPER_ADMIN only: delegate on behalf of another user' })
  @IsOptional()
  @IsString()
  delegatorUserId?: string;
}
