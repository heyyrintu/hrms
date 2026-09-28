import { IsEmail, IsString, MinLength, IsOptional, IsEnum } from 'class-validator';
import { UserRole } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({
    description:
      'Tenant code, for deployments that host more than one tenant (e.g. from /login?org=). ' +
      'Omitted, the server falls back to DEFAULT_TENANT_ID.',
  })
  @IsOptional()
  @IsString()
  tenantCode?: string;
}

export class RegisterDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

/**
 * POST /auth/login can end in one of three shapes (Keka wave H1):
 *  - a normal session (this class), when no second factor applies;
 *  - `{ mfaRequired: true, mfaToken }`, when the account has TOTP enabled —
 *    submit `mfaToken` and a code to `POST /auth/2fa/verify`;
 *  - `{ enrolmentRequired: true, enrolToken }`, when the account's role
 *    requires 2FA but it is not enrolled yet — use `enrolToken` as the
 *    bearer token for `POST /auth/2fa/setup` and `POST /auth/2fa/enable`.
 */
export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    role: UserRole;
    tenantId: string;
    employeeId?: string;
    /** True when the account still carries its shared initial password. */
    mustChangePassword?: boolean;
    /** Permissions granted by the user's custom roles. */
    permissions?: string[];
  };
}
