import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ApprovalNoteDto {
  @ApiPropertyOptional({ description: 'Optional comment recorded on the approval trail' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
