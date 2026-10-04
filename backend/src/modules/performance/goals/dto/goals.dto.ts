import {
  IsString,
  IsOptional,
  IsUUID,
  IsDateString,
  IsNumber,
  IsInt,
  IsEnum,
  IsBoolean,
  IsIn,
  Min,
  Max,
  MinLength,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { GoalOwnerType, KeyResultMetricType } from '@prisma/client';

// ============================================
// Goals
// ============================================

export class CreateGoalDto {
  @ApiPropertyOptional({ enum: GoalOwnerType, description: 'Defaults to EMPLOYEE' })
  @IsOptional()
  @IsEnum(GoalOwnerType)
  ownerType?: GoalOwnerType;

  @ApiPropertyOptional({ description: 'Required for DEPARTMENT goals, refused otherwise' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Goal this one rolls up into' })
  @ValidateIf((o: CreateGoalDto) => o.parentGoalId !== null)
  @IsOptional()
  @IsUUID()
  parentGoalId?: string | null;

  @ApiPropertyOptional({ description: 'Employee goals only; must be your own open review' })
  @IsOptional()
  @IsUUID()
  reviewId?: string;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'YYYY-MM-DD' })
  @IsDateString()
  targetDate: string;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 9.99 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9.99)
  weight?: number;

  @ApiPropertyOptional({ description: 'Post to the feed when an employee goal completes' })
  @IsOptional()
  @IsBoolean()
  shareOnFeed?: boolean;
}

/** `ownerType` is deliberately absent: the whitelist rejects it on update. */
export class UpdateGoalDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional({ enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 9.99 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9.99)
  weight?: number;

  @ApiPropertyOptional({ nullable: true, description: 'null removes the alignment' })
  @ValidateIf((o: UpdateGoalDto) => o.parentGoalId !== null)
  @IsOptional()
  @IsUUID()
  parentGoalId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  shareOnFeed?: boolean;
}

export const GOAL_SCOPES = ['mine', 'team', 'company', 'department'] as const;
export type GoalScope = (typeof GOAL_SCOPES)[number];

export class GoalQueryDto {
  @ApiProperty({ enum: GOAL_SCOPES })
  @IsIn(GOAL_SCOPES as unknown as string[])
  scope: GoalScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class GoalTreeQueryDto {
  @ApiPropertyOptional({ description: 'Limit the tree to one subtree' })
  @IsOptional()
  @IsUUID()
  rootId?: string;
}

// ============================================
// Key results
// ============================================

export class KeyResultDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ enum: KeyResultMetricType })
  @IsOptional()
  @IsEnum(KeyResultMetricType)
  metricType?: KeyResultMetricType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  startValue?: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  targetValue: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  currentValue?: number;

  @ApiPropertyOptional({ maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ minimum: 0.01, maximum: 9.99 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9.99)
  weight?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class UpdateKeyResultDto extends PartialType(KeyResultDto) {}
