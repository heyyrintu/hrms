import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExitController } from './exit.controller';
import { ExitService } from './exit.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExitController],
  providers: [ExitService],
  exports: [ExitService],
})
export class ExitModule {}
