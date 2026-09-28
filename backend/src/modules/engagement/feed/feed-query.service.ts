import { Injectable, NotFoundException } from '@nestjs/common';
import { FeedReactionKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { EngagementSettingsService } from '../settings/engagement-settings.service';

export interface FeedListOptions {
  cursor?: string;
  limit: number;
}

export interface FeedPersonView {
  id: string;
  firstName: string;
  lastName: string;
}

export interface FeedReactionCounts {
  LIKE: number;
  CELEBRATE: number;
}

export interface FeedItemView {
  id: string;
  type: string;
  sourceType: string;
  sourceId: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  occurredAt: Date;
  actor: FeedPersonView | null;
  subject: FeedPersonView | null;
  reactionCounts: FeedReactionCounts;
  myReactions: FeedReactionKind[];
}

export interface FeedPage {
  items: FeedItemView[];
  nextCursor: string | null;
}

export interface ToggleReactionResult {
  reactionCounts: FeedReactionCounts;
  myReactions: FeedReactionKind[];
}

const EMPTY_COUNTS: FeedReactionCounts = { LIKE: 0, CELEBRATE: 0 };

/** Read side of the social feed: listing, reactions and hiding. */
@Injectable()
export class FeedQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: EngagementSettingsService,
  ) {}

  async list(
    tenantId: string,
    employeeId: string | undefined,
    options: FeedListOptions,
  ): Promise<FeedPage> {
    const { cursor, limit } = options;
    const settings = await this.settings.get(tenantId);

    const hiddenTypes: string[] = [];
    if (!settings.showBirthdays) hiddenTypes.push('BIRTHDAY');
    if (!settings.showAnniversaries) hiddenTypes.push('WORK_ANNIVERSARY');

    const where: Prisma.FeedItemWhereInput = {
      tenantId,
      isHidden: false,
      ...(hiddenTypes.length > 0 ? { type: { notIn: hiddenTypes } } : {}),
    };

    if (cursor) {
      const cursorItem = await this.prisma.feedItem.findFirst({
        where: { id: cursor, tenantId },
        select: { id: true, occurredAt: true },
      });
      if (!cursorItem) throw new NotFoundException('Feed item not found');
      where.OR = [
        { occurredAt: { lt: cursorItem.occurredAt } },
        { occurredAt: cursorItem.occurredAt, id: { lt: cursorItem.id } },
      ];
    }

    const rows = await this.prisma.feedItem.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    if (rows.length === 0) return { items: [], nextCursor: null };

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const employeeIds = Array.from(
      new Set(
        page
          .flatMap((r) => [r.actorEmployeeId, r.subjectEmployeeId])
          .filter((id): id is string => !!id),
      ),
    );
    const employees = employeeIds.length
      ? await this.prisma.employee.findMany({
          where: { tenantId, id: { in: employeeIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const employeeMap = new Map(employees.map((e) => [e.id, e]));

    const itemIds = page.map((r) => r.id);
    const [counts, myReactionRows] = await Promise.all([
      this.prisma.feedReaction.groupBy({
        by: ['feedItemId', 'kind'],
        _count: true,
        where: { feedItemId: { in: itemIds } },
      }),
      // Guarded: an undefined employeeId in a Prisma `where` matches every
      // row, which would report everyone's reactions as the caller's.
      employeeId
        ? this.prisma.feedReaction.findMany({
            where: { feedItemId: { in: itemIds }, employeeId },
            select: { feedItemId: true, kind: true },
          })
        : Promise.resolve([] as Array<{ feedItemId: string; kind: FeedReactionKind }>),
    ]);

    const countMap = new Map<string, FeedReactionCounts>();
    for (const row of counts as Array<{ feedItemId: string; kind: FeedReactionKind; _count: number }>) {
      const existing = countMap.get(row.feedItemId) ?? { LIKE: 0, CELEBRATE: 0 };
      existing[row.kind] = row._count;
      countMap.set(row.feedItemId, existing);
    }

    const myReactionsMap = new Map<string, FeedReactionKind[]>();
    for (const row of myReactionRows as Array<{ feedItemId: string; kind: FeedReactionKind }>) {
      const list = myReactionsMap.get(row.feedItemId) ?? [];
      list.push(row.kind);
      myReactionsMap.set(row.feedItemId, list);
    }

    const items: FeedItemView[] = page.map((row) => ({
      id: row.id,
      type: row.type,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      title: row.title,
      body: row.body,
      payload: row.payload as Record<string, unknown>,
      occurredAt: row.occurredAt,
      actor: row.actorEmployeeId ? employeeMap.get(row.actorEmployeeId) ?? null : null,
      subject: row.subjectEmployeeId ? employeeMap.get(row.subjectEmployeeId) ?? null : null,
      reactionCounts: countMap.get(row.id) ?? { ...EMPTY_COUNTS },
      myReactions: myReactionsMap.get(row.id) ?? [],
    }));

    return { items, nextCursor };
  }

  async toggleReaction(
    tenantId: string,
    employeeId: string,
    itemId: string,
    kind: FeedReactionKind,
  ): Promise<ToggleReactionResult> {
    const item = await this.prisma.feedItem.findFirst({
      where: { id: itemId, tenantId, isHidden: false },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Feed item not found');

    const existing = await this.prisma.feedReaction.findFirst({
      where: { feedItemId: itemId, employeeId, kind },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.feedReaction.delete({ where: { id: existing.id } });
    } else {
      try {
        await this.prisma.feedReaction.create({
          data: { tenantId, feedItemId: itemId, employeeId, kind },
        });
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
      }
    }

    return this.reactionSummary(itemId, employeeId);
  }

  async hide(tenantId: string, itemId: string): Promise<void> {
    const result = await this.prisma.feedItem.updateMany({
      where: { id: itemId, tenantId },
      data: { isHidden: true },
    });
    if (result.count === 0) throw new NotFoundException('Feed item not found');
  }

  private async reactionSummary(itemId: string, employeeId: string): Promise<ToggleReactionResult> {
    const [counts, mine] = await Promise.all([
      this.prisma.feedReaction.groupBy({
        by: ['kind'],
        _count: true,
        where: { feedItemId: itemId },
      }),
      this.prisma.feedReaction.findMany({
        where: { feedItemId: itemId, employeeId },
        select: { kind: true },
      }),
    ]);

    const reactionCounts: FeedReactionCounts = { LIKE: 0, CELEBRATE: 0 };
    for (const row of counts as Array<{ kind: FeedReactionKind; _count: number }>) {
      reactionCounts[row.kind] = row._count;
    }

    return {
      reactionCounts,
      myReactions: (mine as Array<{ kind: FeedReactionKind }>).map((m) => m.kind),
    };
  }
}
