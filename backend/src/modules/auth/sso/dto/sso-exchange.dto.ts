import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SsoExchangeDto {
  @ApiProperty({ description: 'Single-use code from the /sso/callback URL fragment.' })
  @IsString()
  @MinLength(1)
  code: string;
}
