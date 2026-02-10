import {
  IsString,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ChangeRequestStatus } from '@prisma/client';

export class CreateChangeRequestDto {
  @ApiProperty({ description: 'Field name to change (e.g., phone, email, designation)' })
  @IsString()
  fieldName: string;

  @ApiProperty({ description: 'New value for the field' })
  @IsString()
  newValue: string;

  @ApiPropertyOptional({ description: 'Reason for the change' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReviewChangeRequestDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsEnum(ChangeRequestStatus)
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
