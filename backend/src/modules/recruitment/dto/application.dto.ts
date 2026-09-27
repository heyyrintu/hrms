import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CandidateSource } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateApplicationDto {
  @ApiProperty()
  @IsUUID()
  candidateId: string;

  @ApiProperty()
  @IsUUID()
  jobOpeningId: string;

  @ApiPropertyOptional({ enum: CandidateSource })
  @IsOptional()
  @IsEnum(CandidateSource)
  source?: CandidateSource;
}

export class MoveApplicationDto {
  @ApiProperty()
  @IsUUID()
  stageId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RejectApplicationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
