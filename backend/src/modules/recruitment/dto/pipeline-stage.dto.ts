import { ApiProperty } from '@nestjs/swagger';
import { PipelineStageCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class PipelineStageItemDto {
  @ApiProperty({ required: false, description: 'Existing stage id; omit to create a new stage' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @ApiProperty({ enum: PipelineStageCategory })
  @IsEnum(PipelineStageCategory)
  category: PipelineStageCategory;
}

export class ReplacePipelineStagesDto {
  @ApiProperty({ type: [PipelineStageItemDto] })
  @ValidateNested({ each: true })
  @Type(() => PipelineStageItemDto)
  stages: PipelineStageItemDto[];
}
