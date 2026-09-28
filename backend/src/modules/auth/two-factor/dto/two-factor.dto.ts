import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyTwoFactorDto {
  @ApiProperty({ description: 'The mfaToken returned by a login that requires a second factor' })
  @IsString()
  mfaToken: string;

  @ApiProperty({ description: 'A 6-digit TOTP code, or a recovery code (xxxxx-xxxxx)' })
  @IsString()
  code: string;
}

export class EnableTwoFactorDto {
  @ApiProperty({ description: 'The 6-digit TOTP code from the authenticator app, for the pending secret' })
  @IsString()
  code: string;
}

export class DisableTwoFactorDto {
  @ApiProperty({ description: "The account's current password" })
  @IsString()
  @MinLength(1)
  password: string;

  @ApiProperty({ description: 'A current 6-digit TOTP code' })
  @IsString()
  code: string;
}

export class RegenerateRecoveryCodesDto {
  @ApiProperty({ description: 'A current 6-digit TOTP code' })
  @IsString()
  code: string;
}
