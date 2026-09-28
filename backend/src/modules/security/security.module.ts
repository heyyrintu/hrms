import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CustomRolesController } from './custom-roles.controller';
import { CustomRolesService } from './custom-roles.service';
import { SecurityUsersController } from './security-users.controller';
import { SecurityUsersService } from './security-users.service';
import { SecuritySettingsController } from './security-settings.controller';
import { SecuritySettingsService } from './security-settings.service';
import { SsoConfigController } from './sso-config.controller';
import { SsoConfigService } from './sso-config.service';

/**
 * Security administration (Keka wave H1): custom roles and their assignment,
 * sign-in policy, SSO provider config and admin 2FA reset.
 *
 * Imports AuthModule for TwoFactorService. AuthModule must never import this
 * module back; the login path reads security settings through Prisma.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    CustomRolesController,
    SecurityUsersController,
    SecuritySettingsController,
    SsoConfigController,
  ],
  providers: [
    CustomRolesService,
    SecurityUsersService,
    SecuritySettingsService,
    SsoConfigService,
  ],
  exports: [SecuritySettingsService, SsoConfigService],
})
export class SecurityModule {}
