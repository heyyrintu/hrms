import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTicketDto {
  @ApiProperty({ description: 'User id of the agent taking the ticket' })
  @IsString()
  @IsNotEmpty()
  assignedToId: string;
}
