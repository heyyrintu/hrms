import { IsArray, IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSecuritySettingsDto {
  @ApiPropertyOptional({
    description:
      'SSO-only sign-in. SUPER_ADMIN password login always stays available as break-glass. ' +
      'Requires at least one enabled SSO provider.',
  })
  @IsOptional()
  @IsBoolean()
  requireSso?: boolean;

  @ApiPropertyOptional({
    enum: UserRole,
    isArray: true,
    description: 'Fixed roles that must enrol in two-factor authentication.',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(UserRole, { each: true })
  twoFactorRequiredRoles?: UserRole[];
}
