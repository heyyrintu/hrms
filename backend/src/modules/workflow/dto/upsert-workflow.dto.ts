import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole, WorkflowApproverType } from '@prisma/client';

export const MAX_WORKFLOW_STEPS = 10;

export class WorkflowStepDto {
  @ApiProperty({ description: 'Shown to approvers and in the trail', example: 'Department head' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: WorkflowApproverType })
  @IsEnum(WorkflowApproverType)
  approverType: WorkflowApproverType;

  @ApiPropertyOptional({ description: 'Required when approverType is SPECIFIC_USER (a user id)' })
  @IsOptional()
  @IsString()
  approverUserId?: string | null;

  @ApiPropertyOptional({ enum: UserRole, description: 'Required when approverType is ROLE' })
  @IsOptional()
  @IsEnum(UserRole)
  approverRole?: UserRole | null;

  @ApiPropertyOptional({
    description: 'Step applies only when the request amount is at least this (not allowed on step 1)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minAmount?: number | null;

  @ApiPropertyOptional({
    description: 'Step applies only when the request spans at least this many days (not allowed on step 1)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minDays?: number | null;
}

export class UpsertWorkflowDto {
  @ApiPropertyOptional({ description: 'Defaults to the built-in name for the type' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ default: true, description: 'HR_ADMIN and SUPER_ADMIN may act on any step' })
  @IsOptional()
  @IsBoolean()
  adminOverride?: boolean;

  @ApiPropertyOptional({ default: true, description: 'When false the requester may never approve' })
  @IsOptional()
  @IsBoolean()
  allowSelfApproval?: boolean;

  @ApiProperty({ type: [WorkflowStepDto], description: `1 to ${MAX_WORKFLOW_STEPS} steps, in order` })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_WORKFLOW_STEPS)
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps: WorkflowStepDto[];
}
