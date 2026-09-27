import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Scaffold shell (Wave E Task 0) — implemented by WS4. */
@Injectable()
export class OneOnOnesService {
  constructor(private readonly prisma: PrismaService) {}
}
