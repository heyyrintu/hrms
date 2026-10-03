import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** Calibration and 9-box (spec F6, F7). Shell from the Keka wave F scaffold. */
@Injectable()
export class CalibrationService {
  constructor(private prisma: PrismaService) {}
}
