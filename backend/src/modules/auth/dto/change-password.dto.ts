import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ description: 'The password currently in use' })
  @IsString()
  currentPassword: string;

  @ApiProperty({ minLength: 8, description: 'The new password' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
