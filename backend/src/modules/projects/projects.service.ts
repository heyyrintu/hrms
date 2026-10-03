import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Projects (Keka wave G, WS-P). Scaffold stub. */
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(): never {
    throw new NotImplementedException();
  }
}
