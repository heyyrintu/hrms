import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsString()
  DATABASE_URL: string;

  @IsString()
  @MinLength(16)
  JWT_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_EXPIRES_IN: string = '7d';

  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 3001;

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsString()
  @IsOptional()
  DEFAULT_TENANT_ID?: string;

  @IsString()
  @IsOptional()
  LOG_LEVEL?: string = 'debug';

  // Storage
  @IsString()
  @IsOptional()
  STORAGE_TYPE?: string = 'local';

  @IsString()
  @IsOptional()
  STORAGE_LOCAL_PATH?: string = './uploads';

  // Email (SMTP) - all optional, email disabled if SMTP_HOST not set
  @IsString()
  @IsOptional()
  SMTP_HOST?: string;

  @IsNumber()
  @IsOptional()
  SMTP_PORT?: number = 587;

  @IsString()
  @IsOptional()
  SMTP_USER?: string;

  @IsString()
  @IsOptional()
  SMTP_PASS?: string;

  @IsString()
  @IsOptional()
  SMTP_FROM?: string = 'HRMS <noreply@hrms.local>';

  // Microsoft Graph API - optional, preferred over SMTP when configured
  @IsString()
  @IsOptional()
  MS_GRAPH_TENANT_ID?: string;

  @IsString()
  @IsOptional()
  MS_GRAPH_CLIENT_ID?: string;

  @IsString()
  @IsOptional()
  MS_GRAPH_CLIENT_SECRET?: string;

  @IsString()
  @IsOptional()
  MS_GRAPH_SENDER_EMAIL?: string;

  // Application-level encryption for sensitive columns (Aadhaar). 32 bytes hex.
  // Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  @IsString()
  @IsOptional()
  @Matches(/^[0-9a-fA-F]{64}$/, { message: 'FIELD_ENCRYPTION_KEY must be 64 hex characters' })
  FIELD_ENCRYPTION_KEY?: string;

  // Source-IP allowlist for the unauthenticated /iclock biometric push endpoint.
  // Comma-separated IPv4 addresses and/or CIDR ranges. Empty = allow all (logged).
  @IsString()
  @IsOptional()
  BIOMETRIC_ALLOWED_IPS?: string;

  // Publishes /api/docs. Defaults to on only in development; set explicitly
  // rather than relying on NODE_ENV being present in every deployment.
  @IsString()
  @IsOptional()
  SWAGGER_ENABLED?: string;

  // Redis - optional, falls back to in-memory if not set
  @IsString()
  @IsOptional()
  REDIS_ENABLED?: string;

  @IsString()
  @IsOptional()
  REDIS_HOST?: string;

  @IsNumber()
  @IsOptional()
  REDIS_PORT?: number = 6379;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  // S3 storage. Documented in deployment.md but not implemented; validated here
  // so the variables are at least recognised rather than silently dropped.
  @IsString()
  @IsOptional()
  AWS_S3_BUCKET?: string;

  @IsString()
  @IsOptional()
  AWS_S3_REGION?: string;

  @IsString()
  @IsOptional()
  AWS_ACCESS_KEY_ID?: string;

  @IsString()
  @IsOptional()
  AWS_SECRET_ACCESS_KEY?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors.map((e) => Object.values(e.constraints || {}).join(', ')).join('\n')}`,
    );
  }

  return validatedConfig;
}
