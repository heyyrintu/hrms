import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { FEED_ITEM_TYPES, PostFeedItemInput } from './feed.types';

/**
 * Write side of the social feed, shared by every producer. The read side is
 * FeedQueryService.
 *
 * Callers inside an interactive transaction: a caught P2002 aborts the
 * transaction in Postgres, so the pre-check `findUnique` is what keeps
 * in-transaction callers (one post per new source id) safe. The P2002 fallback
 * only helps callers outside a transaction racing each other.
 */
@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  /** Idempotent on (tenantId, dedupeKey): an existing key returns its id with `created: false`. */
  async post(
    input: PostFeedItemInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; created: boolean }> {
    if (!(FEED_ITEM_TYPES as readonly string[]).includes(input.type)) {
      throw new Error(`Unknown feed item type: ${input.type}`);
    }
    const db = tx ?? this.prisma;
    const where = {
      tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey: input.dedupeKey },
    };

    const existing = await db.feedItem.findUnique({ where, select: { id: true } });
    if (existing) return { id: existing.id, created: false };

    try {
      const row = await db.feedItem.create({
        data: {
          tenantId: input.tenantId,
          type: input.type,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          actorEmployeeId: input.actorEmployeeId ?? null,
          subjectEmployeeId: input.subjectEmployeeId ?? null,
          title: input.title,
          body: input.body ?? null,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey,
          occurredAt: input.occurredAt ?? new Date(),
          expiresAt: input.expiresAt ?? null,
        },
        select: { id: true },
      });
      return { id: row.id, created: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await db.feedItem.findUnique({ where, select: { id: true } });
        if (again) return { id: again.id, created: false };
      }
      throw e;
    }
  }

  /**
   * Upsert by (tenantId, dedupeKey) for items whose content can change after
   * posting (an edited announcement). An existing item gets its title, body,
   * payload, expiry and people refreshed; `occurredAt`, `type` and source stay
   * as first posted so the item keeps its place in the feed. A missing item is
   * created.
   */
  async refresh(
    input: PostFeedItemInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    if (!(FEED_ITEM_TYPES as readonly string[]).includes(input.type)) {
      throw new Error(`Unknown feed item type: ${input.type}`);
    }
    const db = tx ?? this.prisma;
    const mutable = {
      title: input.title,
      body: input.body ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      expiresAt: input.expiresAt ?? null,
      actorEmployeeId: input.actorEmployeeId ?? null,
      subjectEmployeeId: input.subjectEmployeeId ?? null,
    };

    const row = await db.feedItem.upsert({
      where: { tenantId_dedupeKey: { tenantId: input.tenantId, dedupeKey: input.dedupeKey } },
      update: mutable,
      create: {
        tenantId: input.tenantId,
        type: input.type,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        dedupeKey: input.dedupeKey,
        occurredAt: input.occurredAt ?? new Date(),
        ...mutable,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  /** Delete every feed item of the tenant produced by the given source. Returns the count. */
  async removeBySource(
    tenantId: string,
    sourceType: string,
    sourceId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const db = tx ?? this.prisma;
    const result = await db.feedItem.deleteMany({ where: { tenantId, sourceType, sourceId } });
    return result.count;
  }
}
