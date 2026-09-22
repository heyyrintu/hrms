import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ description: 'The email address the account was created with' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiPropertyOptional({
    description:
      'Tenant code, for deployments that host more than one tenant. ' +
      'Omitted, the server falls back to DEFAULT_TENANT_ID like the login flow.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tenantCode?: string;
}
