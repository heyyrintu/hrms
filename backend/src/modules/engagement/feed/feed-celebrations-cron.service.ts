import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Scaffold shell (Wave E Task 0) — implemented by WS2. */
@Injectable()
export class FeedCelebrationsCronService {
  constructor(private readonly prisma: PrismaService) {}
}
