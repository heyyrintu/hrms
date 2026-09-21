import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsDateString,
  IsInt,
  IsUUID,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PIPStatus } from '@prisma/client';

export class CreateImprovementPlanGoalDto {
  @ApiProperty({ description: 'What the employee has to demonstrate' })
  @IsString()
  description: string;

  @ApiProperty({ description: 'ISO date the goal is due by' })
  @IsDateString()
  targetDate: string;
}

export class CreateImprovementPlanDto {
  @ApiProperty({ description: 'Employee the plan is raised against' })
  @IsUUID()
  employeeId: string;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ description: 'ISO date the plan starts' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'ISO date the plan ends; must be after startDate' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ enum: PIPStatus, default: PIPStatus.DRAFT })
  @IsOptional()
  @IsEnum(PIPStatus)
  status?: PIPStatus;

  @ApiPropertyOptional({ type: [CreateImprovementPlanGoalDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CreateImprovementPlanGoalDto)
  goals?: CreateImprovementPlanGoalDto[];
}

export class UpdateImprovementPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ enum: PIPStatus })
  @IsOptional()
  @IsEnum(PIPStatus)
  status?: PIPStatus;
}

export class AddImprovementPlanGoalDto extends CreateImprovementPlanGoalDto {}

export class UpdateImprovementPlanGoalDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional({ description: 'Progress note against the goal' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ImprovementPlanQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: PIPStatus })
  @IsOptional()
  @IsEnum(PIPStatus)
  status?: PIPStatus;

  @ApiPropertyOptional({ description: 'Filter by employee (HR listing only)' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
