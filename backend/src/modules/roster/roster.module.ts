import { Module } from '@nestjs/common';
import { RosterController } from './roster.controller';
import { RosterService } from './roster.service';
import { RotationPatternsService } from './rotation-patterns.service';
import { ShiftResolverService } from './shift-resolver.service';

/**
 * Keka wave G: shift rotation patterns, the roster grid and the roster-aware
 * shift lookup. PrismaModule is global.
 */
@Module({
  controllers: [RosterController],
  providers: [ShiftResolverService, RotationPatternsService, RosterService],
  exports: [ShiftResolverService, RotationPatternsService, RosterService],
})
export class RosterModule {}
