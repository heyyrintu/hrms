import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ShiftResolverService } from './shift-resolver.service';

/** The roster grid, cells and pattern application (Keka wave G, WS-R). Scaffold stub. */
@Injectable()
export class RosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftResolver: ShiftResolverService,
  ) {}

  getGrid(): never {
    throw new NotImplementedException();
  }
}
