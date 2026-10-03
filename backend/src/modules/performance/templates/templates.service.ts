import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Question bank and review templates (spec F2). Shell from the Keka wave F scaffold. */
@Injectable()
export class TemplatesService {
  constructor(private prisma: PrismaService) {}
}
