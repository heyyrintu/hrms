import { Module } from '@nestjs/common';
import { PipService } from './pip.service';
import { PipController } from './pip.controller';

@Module({
  controllers: [PipController],
  providers: [PipService],
  exports: [PipService],
})
export class PipModule {}
