import { Injectable } from '@nestjs/common';
import { KeyResultMetricType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Progress of one key result, 0-100. Shell (Keka wave F scaffold); WS1
 * implements it.
 */
export function computeKrProgress(kr: {
  metricType: KeyResultMetricType;
  startValue: number;
  targetValue: number;
  currentValue: number;
}): number {
  void kr;
  throw new Error('not implemented');
}

/** Goal progress roll-up (spec F1). Shell; WS1 implements it. */
@Injectable()
export class GoalProgressService {
  constructor(private prisma: PrismaService) {}

  /** Recompute `goalId` and every ancestor inside `tx`; posts feed items for goals that became COMPLETED. */
  async recomputeChain(
    tenantId: string,
    goalId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    void tenantId;
    void goalId;
    void tx;
    throw new Error('not implemented');
  }
}
