import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsIn,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChangeRequestStatus } from '@prisma/client';

export class CreateChangeRequestDto {
  @ApiProperty({ description: 'Field name to change (e.g., phone, email)' })
  @IsString()
  @IsNotEmpty()
  fieldName: string;

  @ApiProperty({ description: 'New value for the field' })
  @IsString()
  @IsNotEmpty()
  newValue: string;

  @ApiPropertyOptional({ description: 'Reason for the change' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class BatchChangeRequestDto {
  @ApiProperty({ type: [CreateChangeRequestDto], description: 'Array of field changes' })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @Type(() => CreateChangeRequestDto)
  changes: CreateChangeRequestDto[];
}

export class ReviewChangeRequestDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn([ChangeRequestStatus.APPROVED, ChangeRequestStatus.REJECTED])
  status: ChangeRequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reviewNote?: string;
}

export class ChangeRequestQueryDto {
  @ApiPropertyOptional({ enum: ChangeRequestStatus })
  @IsOptional()
  @IsEnum(ChangeRequestStatus)
  status?: ChangeRequestStatus;
}
