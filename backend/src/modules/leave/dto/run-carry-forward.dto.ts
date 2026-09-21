import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RunCarryForwardDto {
  @ApiProperty({
    description:
      'The year whose leftover balances are carried into fromYear + 1',
    example: 2025,
  })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fromYear: number;
}
