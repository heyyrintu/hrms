import { IsArray, IsBoolean, IsString, IsUUID, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AnswerInputDto } from '../../dto/performance.dto';

export class AddPeerDto {
  @ApiProperty({ description: 'Employee id of the peer to ask for feedback' })
  @IsUUID()
  peerEmployeeId: string;
}

export class PeerDecisionDto {
  @ApiProperty({ description: 'true approves the nomination, false rejects it' })
  @IsBoolean()
  approve: boolean;
}

export class SubmitPeerFeedbackDto {
  @ApiProperty({ type: [AnswerInputDto], description: 'One answer per PEER question' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerInputDto)
  answers: AnswerInputDto[];

  @ApiProperty({ description: 'Overall comment (1-5000 chars)' })
  @IsString()
  @Length(1, 5000)
  overallComment: string;
}
