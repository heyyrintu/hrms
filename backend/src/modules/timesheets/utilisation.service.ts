import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ShiftResolverService } from '../roster/shift-resolver.service';

/** Utilisation against capacity (Keka wave G, WS-T). Scaffold stub. */
@Injectable()
export class UtilisationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shiftResolver: ShiftResolverService,
  ) {}

  report(): never {
    throw new NotImplementedException();
  }
}
