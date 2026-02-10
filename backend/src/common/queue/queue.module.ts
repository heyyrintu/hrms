import { Global, Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EmailProcessor } from './processors/email.processor';

@Global()
@Module({})
export class QueueModule {
  static register(): DynamicModule {
    const redisEnabled = process.env.REDIS_ENABLED === 'true';

    if (!redisEnabled) {
      return {
        module: QueueModule,
        imports: [],
        providers: [],
        exports: [],
      };
    }

    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          useFactory: (configService: ConfigService) => ({
            connection: {
              host: configService.get<string>('REDIS_HOST', 'localhost'),
              port: configService.get<number>('REDIS_PORT', 6379),
              password:
                configService.get<string>('REDIS_PASSWORD') || undefined,
            },
          }),
          inject: [ConfigService],
        }),
        BullModule.registerQueue(
          { name: 'email' },
          { name: 'reports' },
          { name: 'payroll' },
        ),
      ],
      providers: [EmailProcessor],
      exports: [BullModule],
    };
  }
}
