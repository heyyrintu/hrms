import { Injectable, NotImplementedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Project members (Keka wave G, WS-P). Scaffold stub. */
@Injectable()
export class ProjectMembersService {
  constructor(private readonly prisma: PrismaService) {}

  list(): never {
    throw new NotImplementedException();
  }
}
