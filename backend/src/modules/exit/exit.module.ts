import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExitController } from './exit.controller';
import { ExitService } from './exit.service';
import { SettlementController } from './settlement/settlement.controller';
import { SettlementService } from './settlement/settlement.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExitController, SettlementController],
  providers: [ExitService, SettlementService],
  exports: [ExitService, SettlementService],
})
export class ExitModule {}
