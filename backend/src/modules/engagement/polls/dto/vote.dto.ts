import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VoteDto {
  @ApiProperty({ description: 'The option being voted for' })
  @IsUUID()
  optionId: string;
}
