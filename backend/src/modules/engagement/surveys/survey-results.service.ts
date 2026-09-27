import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Scaffold shell (Wave E Task 0) — implemented by WS1. */
@Injectable()
export class SurveyResultsService {
  constructor(private readonly prisma: PrismaService) {}
}
