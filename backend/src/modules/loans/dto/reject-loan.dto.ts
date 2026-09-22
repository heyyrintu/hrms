import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectLoanDto {
  @ApiProperty({
    description:
      'Why the request was turned down. Shown to the employee verbatim, so it is required.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
