import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Scaffold shell (Wave E Task 0) — implemented by WS3. */
@Injectable()
export class BadgesService {
  constructor(private readonly prisma: PrismaService) {}
}
