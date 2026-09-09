import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Use Winston as the application logger
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  const logger = new Logger('Bootstrap');

  // Raw text body parser for ESSL/ZKTeco ICLOCK device push endpoints.
  // Must be registered before helmet/JSON parsers so the device payload is available as req.body.
  // A punch batch is a few hundred bytes per line. 10mb on an unauthenticated
  // route was an easy way to tie up memory; 256kb still allows thousands of
  // punches in one push.
  app.use('/iclock', express.text({ type: '*/*', limit: '256kb' }));

  // Security headers
  app.use(helmet());

  // Enable CORS from environment variable
  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin: corsOrigin.split(',').map((o) => o.trim()),
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global prefix for API routes.
  // /iclock/* is excluded so ESSL biometric devices can push directly to /iclock/cdata.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'iclock/cdata', method: RequestMethod.GET },
      { path: 'iclock/cdata', method: RequestMethod.POST },
      { path: 'iclock/getrequest', method: RequestMethod.GET },
    ],
  });

  // Swagger API documentation.
  // Gated on an explicit flag rather than NODE_ENV alone: a container that
  // ships without NODE_ENV set would otherwise publish the full API schema.
  const swaggerEnabled =
    process.env.SWAGGER_ENABLED === 'true' ||
    (process.env.SWAGGER_ENABLED === undefined &&
      process.env.NODE_ENV === 'development');
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('HRMS API')
      .setDescription('Human Resource Management System API documentation')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('auth', 'Authentication endpoints')
      .addTag('employees', 'Employee management')
      .addTag('departments', 'Department management')
      .addTag('attendance', 'Attendance tracking')
      .addTag('leave', 'Leave management')
      .addTag('admin', 'Admin operations')
      .addTag('companies', 'Company/Tenant management')
      .addTag('announcements', 'Company announcements')
      .addTag('audit', 'Audit logging')
      .addTag('documents', 'Document management')
      .addTag('expenses', 'Expense management')
      .addTag('holidays', 'Holiday management')
      .addTag('notifications', 'Notification system')
      .addTag('onboarding', 'Employee onboarding')
      .addTag('payroll', 'Payroll processing')
      .addTag('performance', 'Performance reviews')
      .addTag('reports', 'Report generation')
      .addTag('self-service', 'Employee self-service')
      .addTag('shifts', 'Shift management')
      .addTag('uploads', 'File uploads')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    logger.log('Swagger docs available at /api/docs');
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  logger.log(`HRMS Backend running on http://localhost:${port}`);
}

bootstrap();
