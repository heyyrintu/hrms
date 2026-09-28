import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service';
import { AuditService } from '../audit/audit.service';
import { createMockEmailService, createMockPrismaService } from '../../test/helpers';
import { SecurityModule } from './security.module';
import { CustomRolesController } from './custom-roles.controller';
import { SecurityUsersController } from './security-users.controller';
import { SecuritySettingsController } from './security-settings.controller';
import { SsoConfigController } from './sso-config.controller';
import { TwoFactorController } from '../auth/two-factor/two-factor.controller';
import { SsoController } from '../auth/sso/sso.controller';
import { AuthController } from '../auth/auth.controller';

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: createMockPrismaService() },
    { provide: EmailService, useValue: createMockEmailService() },
    { provide: FieldEncryptionService, useValue: {} },
    { provide: AuditService, useValue: { log: jest.fn() } },
  ],
  exports: [PrismaService, EmailService, FieldEncryptionService, AuditService],
})
class GlobalStubsModule {}

/**
 * Scaffold guard (Keka wave H1): SecurityModule and the extended AuthModule
 * resolve, with no import cycle between them.
 */
describe('SecurityModule', () => {
  it('compiles and exposes every security and auth controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: 'test-secret' })],
        }),
        ThrottlerModule.forRoot([]),
        GlobalStubsModule,
        SecurityModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(createMockPrismaService())
      .overrideProvider(EmailService)
      .useValue(createMockEmailService())
      .compile();
    await moduleRef.init();

    for (const controller of [
      CustomRolesController,
      SecurityUsersController,
      SecuritySettingsController,
      SsoConfigController,
      TwoFactorController,
      SsoController,
      AuthController,
    ]) {
      expect(moduleRef.get(controller)).toBeInstanceOf(controller);
    }
  }, 30_000);
});
