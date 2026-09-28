import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { EmailModule } from '../../common/email/email.module';
import { TwoFactorController } from './two-factor/two-factor.controller';
import { TwoFactorService } from './two-factor/two-factor.service';
import { TotpService } from './two-factor/totp.service';
import { RecoveryCodesService } from './two-factor/recovery-codes.service';
import { StepTokenService } from './two-factor/step-token.service';
import { SsoController } from './sso/sso.controller';
import { SsoService } from './sso/sso.service';
import { OidcClientService } from './sso/oidc-client.service';

@Module({
  imports: [
    // EmailModule is @Global, but the password reset flow depends on it
    // directly; the explicit import keeps that dependency visible here.
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is not set');
        }
        const expiresIn = configService.get('JWT_EXPIRES_IN') ?? '7d';
        return {
          secret,
          signOptions: {
            expiresIn: expiresIn as '7d',
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, TwoFactorController, SsoController],
  providers: [
    AuthService,
    PasswordResetService,
    JwtStrategy,
    JwtAuthGuard,
    // Keka wave H1: two-factor authentication and single sign-on
    TwoFactorService,
    TotpService,
    RecoveryCodesService,
    StepTokenService,
    SsoService,
    OidcClientService,
  ],
  exports: [AuthService, JwtAuthGuard, TwoFactorService],
})
export class AuthModule {}
