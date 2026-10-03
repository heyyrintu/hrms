import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Competency framework (spec F3). Shell from the Keka wave F scaffold. */
@Injectable()
export class CompetenciesService {
  constructor(private prisma: PrismaService) {}
}
