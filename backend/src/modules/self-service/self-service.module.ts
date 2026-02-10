import { Module } from '@nestjs/common';
import { SelfServiceController } from './self-service.controller';
import { SelfServiceService } from './self-service.service';

@Module({
  controllers: [SelfServiceController],
  providers: [SelfServiceService],
  exports: [SelfServiceService],
})
export class SelfServiceModule {}
