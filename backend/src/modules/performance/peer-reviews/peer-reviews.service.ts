import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/** 360 peer feedback (spec F5). Shell from the Keka wave F scaffold. */
@Injectable()
export class PeerReviewsService {
  constructor(private prisma: PrismaService) {}
}
