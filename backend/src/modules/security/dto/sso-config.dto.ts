import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PUT /security/sso/:provider body. `clientSecret` is required when creating
 * a provider's config and optional on update (omitted keeps the stored
 * secret). `entraTenantId` is required for MICROSOFT and validated as a GUID
 * by the service, which also normalises `allowedDomains` (trim, lower-case,
 * dedupe, hostname shape). Owned by WS-3 (plan Task 3.1).
 */
export class UpsertSsoConfigDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  clientId: string;

  @ApiPropertyOptional({
    description: 'Required when creating the config for this provider; omit on update to keep the stored secret.',
  })
  @IsOptional()
  @IsString()
  clientSecret?: string;

  @ApiPropertyOptional({
    description: 'Microsoft Entra directory (tenant) id, a GUID. Required for MICROSOFT.',
  })
  @IsOptional()
  @IsString()
  entraTenantId?: string;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    type: [String],
    description: 'Hostnames; empty means any domain (not allowed together with autoCreateUsers).',
  })
  @IsArray()
  @IsString({ each: true })
  allowedDomains: string[];

  @ApiProperty({ description: 'Requires at least one entry in allowedDomains.' })
  @IsBoolean()
  autoCreateUsers: boolean;
}
