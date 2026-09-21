import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  IsNotEmpty,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FeedbackType, FeedbackVisibility } from '@prisma/client';

export class CreateFeedbackDto {
  @ApiProperty({ description: 'Employee the feedback is about' })
  @IsString()
  @IsNotEmpty()
  receiverId: string;

  @ApiProperty({ description: 'The feedback itself' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiProperty({ enum: FeedbackType })
  @IsEnum(FeedbackType)
  type: FeedbackType;

  @ApiPropertyOptional({
    enum: FeedbackVisibility,
    default: FeedbackVisibility.PRIVATE,
    description:
      'Who may read it besides the two participants. Defaults to PRIVATE, which keeps it between sender and receiver.',
  })
  @IsOptional()
  @IsEnum(FeedbackVisibility)
  visibility?: FeedbackVisibility;
}

export class FeedbackQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;
}
