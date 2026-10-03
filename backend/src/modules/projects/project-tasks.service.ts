import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Project tasks (Keka wave G, WS-P). Scaffold stub. */
@Injectable()
export class ProjectTasksService {
  constructor(private readonly prisma: PrismaService) {}

  list(): never {
    throw new NotImplementedException();
  }
}
