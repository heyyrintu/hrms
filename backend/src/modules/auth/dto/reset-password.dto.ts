import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ description: 'The raw token from the emailed reset link' })
  @IsString()
  token: string;

  @ApiProperty({ minLength: 8, description: 'The new password' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
