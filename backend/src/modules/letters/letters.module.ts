import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LettersController } from './letters.controller';
import { LettersService } from './letters.service';

@Module({
  imports: [PrismaModule],
  controllers: [LettersController],
  providers: [LettersService],
  exports: [LettersService],
})
export class LettersModule {}
