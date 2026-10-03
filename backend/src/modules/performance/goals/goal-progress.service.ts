import { BadRequestException, Injectable } from '@nestjs/common';
import { GoalStatus, KeyResultMetricType, Prisma } from '@prisma/client';
import { FeedService } from '../../engagement/feed/feed.service';
import { FEED_SOURCE } from '../../engagement/feed/feed.types';

/** Longest alignment chain the roll-up (and the cycle check) will walk. */
export const MAX_GOAL_DEPTH = 20;

/**
 * Progress of one key result, 0-100. BOOLEAN is all-or-nothing; the rest is
 * the rounded share of the way from start to target (works for decreasing
 * targets), clamped. Callers convert Prisma Decimals with `Number(...)`.
 */
export function computeKrProgress(kr: {
  metricType: KeyResultMetricType;
  startValue: number;
  targetValue: number;
  currentValue: number;
}): number {
  if (kr.metricType === 'BOOLEAN') return kr.currentValue >= 1 ? 100 : 0;
  const span = kr.targetValue - kr.startValue;
  if (span === 0) {
    throw new BadRequestException('Target value must differ from start value');
  }
  const pct = Math.round(((kr.currentValue - kr.startValue) / span) * 100);
  return Math.max(0, Math.min(100, pct));
}

/** The goal fields the roll-up and the feed post read. */
export interface RollupGoal {
  id: string;
  tenantId: string;
  title: string;
  ownerType: string;
  employeeId: string | null;
  shareOnFeed: boolean;
  status: GoalStatus | string;
  completedAt: Date | null;
  parentGoalId: string | null;
  keyResults: Array<{ progress: number; weight: unknown }>;
  children: Array<{ progress: number; weight: unknown }>;
  department?: { name: string } | null;
  review?: { status: string } | null;
}

function weightedMean(rows: Array<{ progress: number; weight: unknown }>): number {
  let total = 0;
  let sum = 0;
  for (const row of rows) {
    const w = Number(row.weight);
    total += w;
    sum += row.progress * w;
  }
  return total > 0 ? Math.round(sum / total) : 0;
}

/** Goal progress roll-up (spec F1). */
@Injectable()
export class GoalProgressService {
  constructor(private feedService: FeedService) {}

  /**
   * Derived progress: key results first, else aligned children, else `null`
   * (a manual goal keeps the progress its owner typed).
   */
  derive(goal: Pick<RollupGoal, 'keyResults' | 'children'>): { progress: number } | null {
    if (goal.keyResults.length > 0) return { progress: weightedMean(goal.keyResults) };
    if (goal.children.length > 0) return { progress: weightedMean(goal.children) };
    return null;
  }

  /**
   * Recompute `goalId` and every ancestor inside `tx`. A goal that becomes
   * COMPLETED here posts its feed item in the same transaction.
   */
  async recomputeChain(
    tenantId: string,
    goalId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    let currentId: string | null = goalId;
    for (let hops = 0; currentId && hops <= MAX_GOAL_DEPTH; hops++) {
      const goal: RollupGoal | null = (await tx.goal.findFirst({
        where: { id: currentId, tenantId },
        include: {
          keyResults: true,
          children: { select: { progress: true, weight: true } },
          department: { select: { name: true } },
          review: { select: { status: true } },
        },
      })) as RollupGoal | null;
      if (!goal) return;

      // A goal locked by a completed review is a record: roll-up walks past it.
      const locked = goal.review?.status === 'COMPLETED';
      const derived = locked ? null : this.derive(goal);
      if (derived) {
        const wasCompleted = goal.status === 'COMPLETED';
        const status: GoalStatus =
          derived.progress === 0
            ? 'NOT_STARTED'
            : derived.progress === 100
              ? 'COMPLETED'
              : 'IN_PROGRESS';
        await tx.goal.update({
          where: { id: goal.id },
          data: {
            progress: derived.progress,
            status,
            completedAt: status === 'COMPLETED' ? (goal.completedAt ?? new Date()) : null,
          },
        });
        if (!wasCompleted && status === 'COMPLETED') await this.postCompletion(goal, tx);
      }
      currentId = goal.parentGoalId;
    }
  }

  /**
   * Feed item for a goal that just became COMPLETED. Company and department
   * goals always post; an employee goal only when its owner shared it. The
   * dedupe key means a goal that is reopened and re-completed never posts twice.
   */
  async postCompletion(
    goal: Pick<RollupGoal, 'id' | 'tenantId' | 'title' | 'ownerType' | 'employeeId' | 'shareOnFeed' | 'department'>,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    if (goal.ownerType === 'EMPLOYEE' && !goal.shareOnFeed) return;
    await this.feedService.post(
      {
        tenantId: goal.tenantId,
        type: 'GOAL_COMPLETED',
        sourceType: FEED_SOURCE.GOAL,
        sourceId: goal.id,
        subjectEmployeeId: goal.employeeId,
        actorEmployeeId: null,
        title: goal.title,
        payload: { ownerType: goal.ownerType, departmentName: goal.department?.name ?? null },
        dedupeKey: `goal-completed:${goal.id}`,
      },
      tx,
    );
  }
}
