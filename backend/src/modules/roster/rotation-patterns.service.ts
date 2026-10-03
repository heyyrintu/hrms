import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Shift rotation patterns (Keka wave G, WS-R). Scaffold stub. */
@Injectable()
export class RotationPatternsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): never {
    throw new NotImplementedException();
  }
}
